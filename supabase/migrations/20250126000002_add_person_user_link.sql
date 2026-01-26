-- Add auth_user_id to link a person to a user account (their "own" person)
-- Admin links persons to users manually via Supabase console
ALTER TABLE public.persons
ADD COLUMN auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_persons_auth_user_id ON public.persons(auth_user_id);
