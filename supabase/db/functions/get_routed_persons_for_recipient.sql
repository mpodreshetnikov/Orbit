-- Function: get_routed_persons_for_recipient()
-- Get persons a user should receive notifications for (explicit routing + implicit own persons)

CREATE OR REPLACE FUNCTION public.get_routed_persons_for_recipient(
  p_recipient_user_id uuid
)
RETURNS TABLE (
  person_id uuid,
  person_name text,
  custom_prefix text,
  person_owner_user_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  -- Explicit routing entries
  SELECT r.person_id, p.name, r.custom_prefix, p.auth_user_id
  FROM public.notification_routing r
  JOIN public.persons p ON p.id = r.person_id
  WHERE r.recipient_user_id = p_recipient_user_id
    AND r.enabled = true
  UNION ALL
  -- Implicit own persons (no explicit routing row)
  SELECT p.id, p.name, NULL::text, p.auth_user_id
  FROM public.persons p
  WHERE p.auth_user_id = p_recipient_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_routing r2
      WHERE r2.recipient_user_id = p_recipient_user_id
        AND r2.person_id = p.id
    );
$$;

COMMENT ON FUNCTION public.get_routed_persons_for_recipient(uuid) IS
  'Returns enabled routed persons for recipient_user_id, plus implicit own person if no explicit routing row exists.';
