-- Fix: allow any authenticated user to create organizations (for onboarding)
DROP POLICY IF EXISTS "organizations_insert" ON public.organizations;
CREATE POLICY "organizations_insert" ON public.organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Atomic function to create org + add creator as admin (bypasses RLS SELECT issue)
CREATE OR REPLACE FUNCTION create_organization_with_owner(org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  INSERT INTO public.organizations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, auth.uid(), 'admin');

  RETURN new_org_id;
END;
$$;

-- Add resource limit columns to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_domain_limit integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS plan_email_address_limit integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS plan_member_limit integer NOT NULL DEFAULT 3;

-- Update email limits to new pricing values
UPDATE public.organizations SET plan_email_limit = 1000 WHERE plan IN ('trial', 'starter');
UPDATE public.organizations SET plan_email_limit = 5000 WHERE plan = 'growth';

-- Backfill resource limits based on current plan
UPDATE public.organizations
SET plan_domain_limit = 1, plan_email_address_limit = 2, plan_member_limit = 3
WHERE plan IN ('trial', 'starter');

UPDATE public.organizations
SET plan_domain_limit = 3, plan_email_address_limit = 5, plan_member_limit = 10
WHERE plan = 'growth';

UPDATE public.organizations
SET plan_domain_limit = 100, plan_email_address_limit = 100, plan_member_limit = 999
WHERE plan = 'enterprise';
