-- Add new statuses for the multi-step OCR workflow with human review
-- Flow: draft -> ocr_processing -> ocr_review -> structuring -> structure_review -> active

-- Add new enum values for OCR workflow stages
ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'ocr_processing' AFTER 'draft';
ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'ocr_review' AFTER 'ocr_processing';
ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'structuring' AFTER 'ocr_review';
ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'structure_review' AFTER 'structuring';

-- Update the comment to reflect new workflow
COMMENT ON TYPE public.record_status IS 'Record lifecycle: draft -> ocr_processing -> ocr_review -> structuring -> structure_review -> active. Can become removed at any point.';
