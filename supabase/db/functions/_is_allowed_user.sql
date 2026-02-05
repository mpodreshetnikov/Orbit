-- Function: _is_allowed_user()
-- DRY helper for RLS policies: checks if current user is in allowed_users

CREATE OR REPLACE FUNCTION public.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.allowed_users au
    WHERE au.auth_user_id = (select auth.uid())
       OR au.email = (select auth.email())
  );
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.is_allowed_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_allowed_user() TO authenticated;

COMMENT ON FUNCTION public.is_allowed_user() IS
  'Returns true if current user is in allowed_users table (by auth_user_id or email). Used by RLS policies.';
