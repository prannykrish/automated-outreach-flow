-- Campaign usage tracking (parallel to email_usage)
CREATE TABLE IF NOT EXISTS public.campaign_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month text NOT NULL,
  campaigns_run integer NOT NULL DEFAULT 0,
  prospects_researched integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, month)
);

CREATE INDEX IF NOT EXISTS idx_campaign_usage_org_month ON public.campaign_usage(organization_id, month);

ALTER TABLE public.campaign_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view campaign usage"
  ON public.campaign_usage FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

-- Add campaign limit column to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_campaign_limit integer NOT NULL DEFAULT 5;

-- Backfill campaign limits based on current plan
UPDATE public.organizations SET plan_campaign_limit = 5 WHERE plan IN ('trial', 'starter');
UPDATE public.organizations SET plan_campaign_limit = 20 WHERE plan = 'growth';
UPDATE public.organizations SET plan_campaign_limit = 9999 WHERE plan = 'enterprise';

-- Trial abuse prevention: track which email domain created this org
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_domain text;

-- Backfill trial_domain from the org creator's email
UPDATE public.organizations o
SET trial_domain = split_part(u.email, '@', 2)
FROM public.organization_members om
JOIN auth.users u ON u.id = om.user_id
WHERE om.organization_id = o.id
  AND om.role = 'admin'
  AND o.trial_domain IS NULL;

-- Atomic counter for campaign usage
CREATE OR REPLACE FUNCTION public.increment_campaign_usage(
  org_id uuid,
  usage_month text,
  campaign_count integer DEFAULT 1,
  prospect_count integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result record;
BEGIN
  INSERT INTO campaign_usage (organization_id, month, campaigns_run, prospects_researched)
  VALUES (org_id, usage_month, campaign_count, prospect_count)
  ON CONFLICT (organization_id, month)
  DO UPDATE SET
    campaigns_run = campaign_usage.campaigns_run + campaign_count,
    prospects_researched = campaign_usage.prospects_researched + prospect_count,
    updated_at = now()
  RETURNING campaigns_run, prospects_researched INTO result;

  RETURN json_build_object(
    'campaigns_run', result.campaigns_run,
    'prospects_researched', result.prospects_researched
  );
END;
$$;

-- Check if an org is allowed to run campaigns
CREATE OR REPLACE FUNCTION public.check_campaign_allowance(org_id uuid)
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

  -- Check campaign usage
  current_month := to_char(now(), 'YYYY-MM');
  SELECT COALESCE(cu.campaigns_run, 0) INTO current_usage
  FROM campaign_usage cu WHERE cu.organization_id = org_id AND cu.month = current_month;

  IF COALESCE(current_usage, 0) >= org.plan_campaign_limit AND org.plan != 'enterprise' THEN
    RETURN json_build_object(
      'allowed', false,
      'reason', 'Monthly campaign limit reached',
      'used', COALESCE(current_usage, 0),
      'limit', org.plan_campaign_limit
    );
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'used', COALESCE(current_usage, 0),
    'limit', org.plan_campaign_limit,
    'plan', org.plan
  );
END;
$$;

-- Update create_organization_with_owner to enforce one trial per business domain
CREATE OR REPLACE FUNCTION create_organization_with_owner(org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_org_id UUID;
  user_email TEXT;
  email_domain TEXT;
  is_free_provider BOOLEAN;
  existing_trial_org RECORD;
BEGIN
  -- Check if user is already in an org
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are already a member of an organization.';
  END IF;

  -- Extract email domain for trial abuse check
  SELECT email INTO user_email FROM auth.users WHERE id = auth.uid();
  email_domain := split_part(user_email, '@', 2);

  -- Common free email providers — skip domain-based trial check for these
  is_free_provider := email_domain IN (
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'live.com', 'aol.com', 'icloud.com', 'mail.com',
    'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com',
    'gmx.com', 'gmx.net', 'fastmail.com', 'tutanota.com'
  );

  INSERT INTO public.organizations (name, trial_domain)
  VALUES (org_name, email_domain)
  RETURNING id INTO new_org_id;

  -- For business domains: if another org already used a trial with this domain,
  -- expire the new org's trial immediately (they can still subscribe)
  IF NOT is_free_provider THEN
    SELECT id INTO existing_trial_org
    FROM public.organizations
    WHERE trial_domain = email_domain
      AND id != new_org_id
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.organizations
      SET trial_ends_at = now()
      WHERE id = new_org_id;
    END IF;
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, auth.uid(), 'admin');

  RETURN new_org_id;
END;
$$;
