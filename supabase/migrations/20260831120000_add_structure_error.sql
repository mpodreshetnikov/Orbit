-- Add structure_error for structuring (health-structure) failure tracking, mirroring ocr_error.
-- A failed structuring previously left nothing behind but a toast, so a user reporting "it did
-- not work" and the developer reading the row had no shared fact to look at.
ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS structure_error text;

COMMENT ON COLUMN public.medical_records.structure_error IS 'Error message when structuring (health-structure) fails; cleared on success or retry.';
