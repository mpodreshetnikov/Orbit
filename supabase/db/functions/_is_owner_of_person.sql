-- Function: _is_owner_of_person(uuid)
-- DRY helper for RLS policies: checks if current user owns the person

CREATE OR REPLACE FUNCTION public.is_owner_of_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.persons p
    WHERE p.id = p_person_id
      AND p.auth_user_id = auth.uid()
  );
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.is_owner_of_person(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_of_person(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_owner_of_person(uuid) IS
  'Returns true if current user owns the given person. Used by person-scoped RLS policies.';
