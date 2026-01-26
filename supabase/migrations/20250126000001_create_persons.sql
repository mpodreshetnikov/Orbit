-- Create persons table for family members and pets
CREATE TABLE IF NOT EXISTS public.persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('human', 'pet')),
  species text, -- nullable, for pets (e.g., "dog", "cat")
  birthday date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only SELECT needed (INSERT/UPDATE/DELETE done via Supabase console with service role)
CREATE POLICY "Allowed users can read all persons"
  ON public.persons FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- No INSERT/UPDATE/DELETE policies - admin manages persons via Supabase console (service role bypasses RLS)

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_persons_kind ON public.persons(kind);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on persons table
CREATE TRIGGER update_persons_updated_at
  BEFORE UPDATE ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
