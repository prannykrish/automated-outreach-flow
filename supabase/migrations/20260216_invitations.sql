-- Invitations table for email-based org invites
CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  invited_by UUID REFERENCES public.users(id),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations(organization_id, status);

-- RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Org admins can view invitations for their org
CREATE POLICY "Admins can view org invitations"
  ON public.invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- Org admins can create invitations
CREATE POLICY "Admins can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- Org admins can delete invitations (revoke)
CREATE POLICY "Admins can delete invitations"
  ON public.invitations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- Public RPC to get invitation details (for the auth page, before login)
CREATE OR REPLACE FUNCTION get_invitation_details(invite_token UUID)
RETURNS TABLE(organization_name TEXT, invited_email TEXT, invited_role TEXT, invite_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT o.name, i.email, i.role, i.status
  FROM public.invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token = invite_token;
END;
$$;

-- RPC to accept an invitation (called after sign-up/sign-in)
CREATE OR REPLACE FUNCTION accept_invitation(invite_token UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv RECORD;
BEGIN
  -- Get and validate invitation
  SELECT * INTO inv
  FROM public.invitations
  WHERE token = invite_token
    AND status = 'pending'
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  -- Check if already a member
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = inv.organization_id
      AND user_id = auth.uid()
  ) THEN
    -- Already a member, just mark invite as accepted
    UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;
    RETURN inv.organization_id;
  END IF;

  -- Add user to organization
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (inv.organization_id, auth.uid(), inv.role);

  -- Mark invitation as accepted
  UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;

  RETURN inv.organization_id;
END;
$$;
