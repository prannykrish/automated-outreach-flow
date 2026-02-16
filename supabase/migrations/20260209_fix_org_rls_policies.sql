-- Fix RLS policies for organization tables:
-- 1. Add missing INSERT/UPDATE/DELETE policies on organization_members
-- 2. Scope all org policies to org membership (not open to all users)

-- Ensure RLS is enabled on all org tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_emails ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- organizations
-- ============================================================
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;

-- Users can only see organizations they belong to
CREATE POLICY "organizations_select_member"
  ON public.organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
    )
  );

-- ============================================================
-- organization_members
-- ============================================================
DROP POLICY IF EXISTS "org_members_select" ON public.organization_members;

-- Members can see other members in their org
CREATE POLICY "org_members_select"
  ON public.organization_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members AS om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- Admins can add members to their org
CREATE POLICY "org_members_insert"
  ON public.organization_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members AS om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- Admins can update member roles in their org
CREATE POLICY "org_members_update"
  ON public.organization_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members AS om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- Admins can remove members from their org
CREATE POLICY "org_members_delete"
  ON public.organization_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members AS om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- ============================================================
-- organization_domains
-- ============================================================
DROP POLICY IF EXISTS "Allow all" ON public.organization_domains;

-- Members can view domains in their org
CREATE POLICY "org_domains_select"
  ON public.organization_domains FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_domains.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- Admins can add domains (note: the edge function uses service_role which bypasses RLS,
-- but this policy is here for defense-in-depth)
CREATE POLICY "org_domains_insert"
  ON public.organization_domains FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_domains.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- Admins can update domains
CREATE POLICY "org_domains_update"
  ON public.organization_domains FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_domains.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- Admins can delete domains
CREATE POLICY "org_domains_delete"
  ON public.organization_domains FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_domains.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- ============================================================
-- organization_emails
-- ============================================================
DROP POLICY IF EXISTS "Allow all" ON public.organization_emails;

-- Members can view emails in their org
CREATE POLICY "org_emails_select"
  ON public.organization_emails FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_emails.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- Admins can add sending emails
CREATE POLICY "org_emails_insert"
  ON public.organization_emails FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_emails.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- Admins can update emails (e.g., set default)
CREATE POLICY "org_emails_update"
  ON public.organization_emails FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_emails.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- Admins can delete emails
CREATE POLICY "org_emails_delete"
  ON public.organization_emails FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_members.organization_id = organization_emails.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );
