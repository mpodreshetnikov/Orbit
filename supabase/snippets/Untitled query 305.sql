-- Drop the old policy
DROP POLICY IF EXISTS "Users can read their own allowed_users entry" ON public.allowed_users;

-- Create the simpler policy
CREATE POLICY "Authenticated users can read allowed_users"
  ON public.allowed_users
  FOR SELECT
  TO authenticated
  USING (true);