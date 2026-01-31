-- ============================================================================
-- LLM-suggested checkup completions on medical record (structure extraction)
-- User reviews in structure_review; completions created only on Save & activate
-- ============================================================================

ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS llm_suggested_checkup_completions jsonb DEFAULT NULL;

COMMENT ON COLUMN public.medical_records.llm_suggested_checkup_completions IS
  'Array of { checkup_item_id, reason, suggested_done_at, checkup_title } from LLM; applied only when record is activated';
