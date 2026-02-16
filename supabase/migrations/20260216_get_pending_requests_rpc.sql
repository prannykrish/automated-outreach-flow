-- RPC function to get pending join requests for an org (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_pending_join_requests(org_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  organization_id uuid,
  status text,
  created_at timestamptz,
  user_email text,
  user_name text,
  user_first_name text,
  user_last_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jr.id,
    jr.user_id,
    jr.organization_id,
    jr.status,
    jr.created_at,
    u.email AS user_email,
    u.name AS user_name,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name
  FROM public.join_requests jr
  JOIN public.users u ON u.id = jr.user_id
  WHERE jr.organization_id = org_id
    AND jr.status = 'pending'
  ORDER BY jr.created_at ASC;
$$;
