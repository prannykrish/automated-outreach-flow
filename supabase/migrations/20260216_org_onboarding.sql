-- Add invite_code to organizations
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- Backfill existing organizations with random 8-char codes
UPDATE public.organizations
SET invite_code = upper(substr(md5(random()::text || id::text), 1, 8))
WHERE invite_code IS NULL;

-- Make it NOT NULL after backfill
ALTER TABLE public.organizations
ALTER COLUMN invite_code SET NOT NULL;

-- Add default for new rows
ALTER TABLE public.organizations
ALTER COLUMN invite_code SET DEFAULT upper(substr(md5(random()::text || gen_random_uuid()::text), 1, 8));

-- Create join_requests table
CREATE TABLE IF NOT EXISTS public.join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES public.users(id),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_org_status ON public.join_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_join_requests_user ON public.join_requests(user_id);

-- RLS policies for join_requests
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;

-- Users can see their own requests
CREATE POLICY "Users can view own requests"
  ON public.join_requests FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own requests (max 3 pending)
CREATE POLICY "Users can create own requests"
  ON public.join_requests FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT count(*) FROM public.join_requests jr WHERE jr.user_id = auth.uid() AND jr.status = 'pending') < 3
  );

-- Org admins can view requests for their org
CREATE POLICY "Admins can view org requests"
  ON public.join_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = join_requests.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- Org admins can update requests for their org (approve/reject)
CREATE POLICY "Admins can update org requests"
  ON public.join_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = join_requests.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- Function to regenerate invite code (admin only)
CREATE OR REPLACE FUNCTION regenerate_invite_code(org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_code TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  new_code := upper(substr(md5(random()::text || gen_random_uuid()::text), 1, 8));

  UPDATE public.organizations
  SET invite_code = new_code, updated_at = now()
  WHERE id = org_id;

  RETURN new_code;
END;
$$;

-- Lookup org by invite code (anyone authenticated)
CREATE OR REPLACE FUNCTION lookup_org_by_invite_code(code TEXT)
RETURNS TABLE(id UUID, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.name
  FROM public.organizations o
  WHERE o.invite_code = upper(trim(code));
END;
$$;
