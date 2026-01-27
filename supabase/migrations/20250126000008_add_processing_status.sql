-- Add 'processing' status to record_status enum
-- This allows records to be in a "processing" state while OCR runs in background

ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'processing' AFTER 'draft';

-- Update the search_medical_records function to handle processing status
-- This function already works with any status, no changes needed

COMMENT ON TYPE public.record_status IS 'Record lifecycle: draft -> processing -> active, or draft -> active, can become removed at any point';
