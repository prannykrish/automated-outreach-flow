-- Fix infinite recursion in org RLS policies.
-- The previous migration's policies on organization_members referenced
-- organization_members in subqueries, causing PostgreSQL to detect
-- infinite recursion.
--
-- Solution: SECURITY DEFINER helper functions that bypass RLS when
-- looking up the current user's org memberships.

-- ============================================================
-- Helper functions (SECURITY DEFINER = bypass RLS)
-- ============================================================

-- Returns org IDs the current user belongs to
CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid();
$$;

-- Returns org IDs where the current user is an admin
CREATE OR REPLACE FUNCTION public.get_user_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid() AND role = 'admin';
$$;

-- Returns whether the current user is a super admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- ============================================================
-- Drop ALL existing org policies (clean slate)
-- ============================================================

-- organizations
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
DROP POLICY IF EXISTS "organizations_select_member" ON public.organizations;

-- organization_members
DROP POLICY IF EXISTS "org_members_select" ON public.organization_members;
DROP POLICY IF EXISTS "org_members_insert" ON public.organization_members;
DROP POLICY IF EXISTS "org_members_update" ON public.organization_members;
DROP POLICY IF EXISTS "org_members_delete" ON public.organization_members;

-- organization_domains
DROP POLICY IF EXISTS "Allow all" ON public.organization_domains;
DROP POLICY IF EXISTS "org_domains_select" ON public.organization_domains;
DROP POLICY IF EXISTS "org_domains_insert" ON public.organization_domains;
DROP POLICY IF EXISTS "org_domains_update" ON public.organization_domains;
DROP POLICY IF EXISTS "org_domains_delete" ON public.organization_domains;

-- organization_emails
DROP POLICY IF EXISTS "Allow all" ON public.organization_emails;
DROP POLICY IF EXISTS "org_emails_select" ON public.organization_emails;
DROP POLICY IF EXISTS "org_emails_insert" ON public.organization_emails;
DROP POLICY IF EXISTS "org_emails_update" ON public.organization_emails;
DROP POLICY IF EXISTS "org_emails_delete" ON public.organization_emails;

-- ============================================================
-- organizations
-- ============================================================

CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (
    id IN (SELECT public.get_user_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "organizations_insert" ON public.organizations
  FOR INSERT WITH CHECK (
    public.is_super_admin()
  );

CREATE POLICY "organizations_update" ON public.organizations
  FOR UPDATE USING (
    id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "organizations_delete" ON public.organizations
  FOR DELETE USING (
    public.is_super_admin()
  );

-- ============================================================
-- organization_members
-- ============================================================

CREATE POLICY "org_members_select" ON public.organization_members
  FOR SELECT USING (
    organization_id IN (SELECT public.get_user_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_members_insert" ON public.organization_members
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_members_update" ON public.organization_members
  FOR UPDATE USING (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_members_delete" ON public.organization_members
  FOR DELETE USING (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

-- ============================================================
-- organization_domains
-- ============================================================

CREATE POLICY "org_domains_select" ON public.organization_domains
  FOR SELECT USING (
    organization_id IN (SELECT public.get_user_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_domains_insert" ON public.organization_domains
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_domains_update" ON public.organization_domains
  FOR UPDATE USING (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_domains_delete" ON public.organization_domains
  FOR DELETE USING (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

-- ============================================================
-- organization_emails
-- ============================================================

CREATE POLICY "org_emails_select" ON public.organization_emails
  FOR SELECT USING (
    organization_id IN (SELECT public.get_user_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_emails_insert" ON public.organization_emails
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_emails_update" ON public.organization_emails
  FOR UPDATE USING (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );

CREATE POLICY "org_emails_delete" ON public.organization_emails
  FOR DELETE USING (
    organization_id IN (SELECT public.get_user_admin_org_ids()) OR public.is_super_admin()
  );
