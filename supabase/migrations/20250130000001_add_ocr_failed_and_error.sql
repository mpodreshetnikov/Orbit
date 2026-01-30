-- Add ocr_failed status and ocr_error column for OCR error tracking and retry
ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'ocr_failed' AFTER 'ocr_processing';

ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS ocr_error text;

COMMENT ON COLUMN public.medical_records.ocr_error IS 'Error message when OCR (health-ocr) fails; cleared on success or retry.';
