-- Policies for allowed_users table

DROP POLICY IF EXISTS "allowed_users_select" ON public.allowed_users;
CREATE POLICY "allowed_users_select" ON public.allowed_users
  FOR SELECT TO authenticated
  USING (true);

-- Note: No INSERT/UPDATE/DELETE policies - admin only via service role
