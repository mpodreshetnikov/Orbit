-- Create allowed_users table for access control
-- Users can be pre-approved by email (auth_user_id will be NULL until they sign in)
CREATE TABLE IF NOT EXISTS public.allowed_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.allowed_users ENABLE ROW LEVEL SECURITY;

-- Policy: Allow any authenticated user to read the allowlist
-- The actual authorization check is done in middleware using the query results
-- This is safe because knowing who's in the allowlist doesn't expose sensitive data
CREATE POLICY "Authenticated users can read allowed_users"
  ON public.allowed_users
  FOR SELECT
  TO authenticated
  USING (true);

-- Note: With RLS enabled and no INSERT/UPDATE/DELETE policies defined,
-- writes are denied by default for non-service-role users.
-- Admin operations are done via SQL Editor which uses service role.

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_allowed_users_auth_user_id ON public.allowed_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_allowed_users_email ON public.allowed_users(email);

-- Function to link auth_user_id when user signs in
-- This updates the allowed_users entry with the auth_user_id if it was pre-approved by email
CREATE OR REPLACE FUNCTION public.link_allowed_user()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.allowed_users
  SET auth_user_id = NEW.id
  WHERE email = NEW.email AND auth_user_id IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-link when a new user is created in auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.link_allowed_user();
