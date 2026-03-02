-- Onboarding progress: one row per (user_id, organization_id)
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role              text        NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin', 'member')),
  completed_steps   text[]      NOT NULL DEFAULT '{}',
  dismissed         boolean     NOT NULL DEFAULT false,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user_org
  ON public.onboarding_progress(user_id, organization_id);

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own onboarding progress"
  ON public.onboarding_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding progress"
  ON public.onboarding_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding progress"
  ON public.onboarding_progress FOR UPDATE
  USING (auth.uid() = user_id);

-- Add trial lifetime email limit to organizations (200 for trial, ignored for paid plans)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_email_total_limit integer NOT NULL DEFAULT 200;

-- Update check_email_allowance: trial orgs use lifetime total, paid orgs use monthly
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

  -- Check trial expiry (time-based)
  IF org.plan = 'trial' AND org.trial_ends_at < now() THEN
    RETURN json_build_object('allowed', false, 'reason', 'Trial expired', 'plan', 'trial');
  END IF;

  -- Check canceled
  IF org.billing_status = 'canceled' THEN
    RETURN json_build_object('allowed', false, 'reason', 'Subscription canceled');
  END IF;

  IF org.plan = 'trial' THEN
    -- Trial: LIFETIME total cap (sum all months)
    SELECT COALESCE(SUM(eu.emails_sent), 0) INTO current_usage
    FROM email_usage eu
    WHERE eu.organization_id = org_id;

    IF current_usage >= org.trial_email_total_limit THEN
      RETURN json_build_object(
        'allowed', false,
        'reason', 'Free trial email limit reached. Upgrade to continue sending emails.',
        'used', current_usage,
        'limit', org.trial_email_total_limit,
        'plan', 'trial'
      );
    END IF;

    RETURN json_build_object(
      'allowed', true,
      'used', current_usage,
      'limit', org.trial_email_total_limit,
      'plan', 'trial'
    );
  ELSE
    -- Paid plans: monthly limit (unchanged)
    current_month := to_char(now(), 'YYYY-MM');
    SELECT COALESCE(eu.emails_sent, 0) INTO current_usage
    FROM email_usage eu
    WHERE eu.organization_id = org_id AND eu.month = current_month;

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
  END IF;
END;
$$;
