-- ============================================================================
-- ADD SEX AND BREED TO PERSONS TABLE
-- Sex for humans, breed for pets
-- ============================================================================

-- Add sex column for humans (male, female, other)
ALTER TABLE public.persons 
ADD COLUMN IF NOT EXISTS sex text CHECK (sex IS NULL OR sex IN ('male', 'female', 'other'));

-- Add breed column for pets (e.g., "Labrador", "Persian")
ALTER TABLE public.persons 
ADD COLUMN IF NOT EXISTS breed text;

-- Add comment for documentation
COMMENT ON COLUMN public.persons.sex IS 'Sex of the person (for humans only): male, female, or other';
COMMENT ON COLUMN public.persons.breed IS 'Breed of the pet (for pets only), e.g., Labrador, Persian';
