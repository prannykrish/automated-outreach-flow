-- Add in_reply_to_log_id to email_logs for proper reply threading
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS in_reply_to_log_id uuid REFERENCES public.email_logs(id) ON DELETE SET NULL;

-- Add trial_email to organizations for normalized email tracking (alias-stripped)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_email text;

-- Backfill trial_email from the org creator's normalized email
UPDATE public.organizations o
SET trial_email = regexp_replace(split_part(u.email, '@', 1), '\+[^@]*', '', 'g') || '@' || split_part(u.email, '@', 2)
FROM public.organization_members om
JOIN auth.users u ON u.id = om.user_id
WHERE om.organization_id = o.id
  AND om.role = 'admin'
  AND o.trial_email IS NULL;

-- Known disposable email domains
-- These are blocked entirely at signup
CREATE OR REPLACE FUNCTION is_disposable_email(email_domain text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT email_domain IN (
    'guerrillamail.com', 'guerrillamail.info', 'guerrillamailblock.com', 'grr.la',
    'mailinator.com', 'tempmail.com', '10minutemail.com', 'dispostable.com',
    'yopmail.com', 'throwaway.email', 'sharklasers.com', 'trashmail.com',
    'temp-mail.org', 'fakeinbox.com', 'mailnesia.com', 'maildrop.cc',
    'getairmail.com', 'mohmal.com', 'tempail.com', 'burnermail.io',
    'guerrillamail.net', 'guerrillamail.de', 'spam4.me', 'trash-mail.com',
    'byom.de', 'mytemp.email', 'harakirimail.com', 'mailcatch.com',
    'tempr.email', 'discard.email', 'mailnull.com'
  );
$$;

-- Update create_organization_with_owner with:
-- 1. Gmail/Outlook + alias stripping
-- 2. Disposable email domain blocking
-- 3. Normalized email tracking for free providers
CREATE OR REPLACE FUNCTION create_organization_with_owner(org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_org_id UUID;
  user_email TEXT;
  email_domain TEXT;
  normalized_email TEXT;
  email_local TEXT;
  is_free_provider BOOLEAN;
  is_disposable BOOLEAN;
  existing_trial_org RECORD;
BEGIN
  -- Check if user is already in an org
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are already a member of an organization.';
  END IF;

  -- Get and normalize the email
  SELECT email INTO user_email FROM auth.users WHERE id = auth.uid();
  email_domain := lower(split_part(user_email, '@', 2));

  -- Block disposable email domains entirely
  is_disposable := is_disposable_email(email_domain);
  IF is_disposable THEN
    RAISE EXCEPTION 'Please use a non-disposable email address to create an account.';
  END IF;

  -- Strip + aliases: me+anything@gmail.com → me@gmail.com
  email_local := split_part(user_email, '@', 1);
  email_local := regexp_replace(email_local, '\+.*$', '');
  normalized_email := lower(email_local || '@' || email_domain);

  -- Common free email providers
  is_free_provider := email_domain IN (
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'live.com', 'aol.com', 'icloud.com', 'mail.com',
    'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com',
    'gmx.com', 'gmx.net', 'fastmail.com', 'tutanota.com',
    'me.com', 'msn.com', 'yahoo.co.uk', 'yahoo.co.in',
    'outlook.co.uk', 'hotmail.co.uk'
  );

  INSERT INTO public.organizations (name, trial_domain, trial_email)
  VALUES (org_name, email_domain, normalized_email)
  RETURNING id INTO new_org_id;

  -- For business domains: check if another org already used a trial with this domain
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
  ELSE
    -- For free providers: check if another org used the same normalized email
    SELECT id INTO existing_trial_org
    FROM public.organizations
    WHERE trial_email = normalized_email
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
