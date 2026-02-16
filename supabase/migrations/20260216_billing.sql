-- Add billing columns to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial', 'starter', 'growth', 'enterprise', 'canceled')),
  ADD COLUMN IF NOT EXISTS plan_email_limit integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'trialing'
    CHECK (billing_status IN ('trialing', 'active', 'past_due', 'canceled')),
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- Backfill existing orgs with trial_ends_at
UPDATE public.organizations
SET trial_ends_at = created_at + interval '14 days'
WHERE trial_ends_at IS NULL;

-- Email usage tracking table
CREATE TABLE IF NOT EXISTS public.email_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month text NOT NULL,
  emails_sent integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, month)
);

CREATE INDEX IF NOT EXISTS idx_email_usage_org_month ON public.email_usage(organization_id, month);

ALTER TABLE public.email_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view usage"
  ON public.email_usage FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

-- Atomic counter for email usage
CREATE OR REPLACE FUNCTION public.increment_email_usage(org_id uuid, send_month text, count integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO email_usage (organization_id, month, emails_sent)
  VALUES (org_id, send_month, count)
  ON CONFLICT (organization_id, month)
  DO UPDATE SET emails_sent = email_usage.emails_sent + count, updated_at = now()
  RETURNING emails_sent INTO new_count;
  RETURN new_count;
END;
$$;

-- Check if an org is allowed to send emails
CREATE OR REPLACE FUNCTION public.check_email_allowance(org_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org record;
  current_usage integer;
  current_month text;
BEGIN
  SELECT * INTO org FROM organizations WHERE id = org_id;
  IF NOT FOUND THEN
    RETURN json_build_object('allowed', false, 'reason', 'Organization not found');
  END IF;

  -- Check trial expiry
  IF org.plan = 'trial' AND org.trial_ends_at < now() THEN
    RETURN json_build_object('allowed', false, 'reason', 'Trial expired', 'plan', 'trial');
  END IF;

  -- Check canceled
  IF org.billing_status = 'canceled' THEN
    RETURN json_build_object('allowed', false, 'reason', 'Subscription canceled');
  END IF;

  -- Check usage
  current_month := to_char(now(), 'YYYY-MM');
  SELECT COALESCE(eu.emails_sent, 0) INTO current_usage
  FROM email_usage eu WHERE eu.organization_id = org_id AND eu.month = current_month;

  IF COALESCE(current_usage, 0) >= org.plan_email_limit AND org.plan != 'enterprise' THEN
    RETURN json_build_object(
      'allowed', false,
      'reason', 'Monthly email limit reached',
      'used', COALESCE(current_usage, 0),
      'limit', org.plan_email_limit
    );
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'used', COALESCE(current_usage, 0),
    'limit', org.plan_email_limit,
    'plan', org.plan
  );
END;
$$;
