-- Prevent users from being in multiple organizations.
-- Updates both accept_invitation and create_organization_with_owner RPCs.

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

  -- Check if already a member of THIS org
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = inv.organization_id
      AND user_id = auth.uid()
  ) THEN
    UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;
    RETURN inv.organization_id;
  END IF;

  -- Check if already a member of ANY org
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are already a member of another organization. Leave your current organization first.';
  END IF;

  -- Add user to organization
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (inv.organization_id, auth.uid(), inv.role);

  -- Mark invitation as accepted
  UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;

  RETURN inv.organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_organization_with_owner(org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Check if user is already in an org
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are already a member of an organization.';
  END IF;

  INSERT INTO public.organizations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, auth.uid(), 'admin');

  RETURN new_org_id;
END;
$$;
