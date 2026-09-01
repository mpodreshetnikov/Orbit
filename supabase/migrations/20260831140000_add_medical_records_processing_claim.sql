-- An owning claim for the long-running record pipelines (health-ocr, health-structure).
--
-- Two workers on the same record used to be serialised by nothing: the status predicate a
-- conditional update could offer still matched for the second caller once the first had set
-- `structuring`, and every terminal write updated by id alone, so a worker whose client had
-- already given up still overwrote the state that replaced it. The claim names its owner, and
-- terminal writes are conditioned on still holding it.
ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS processing_run_id uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

COMMENT ON COLUMN public.medical_records.processing_run_id IS
  'Identifies the pipeline run that currently owns this record. Cleared when the run reaches a terminal state; a stale claim expires by processing_started_at.';
COMMENT ON COLUMN public.medical_records.processing_started_at IS
  'When the current claim was taken. A claim older than the lease timeout is treated as abandoned and can be taken over.';

CREATE INDEX IF NOT EXISTS idx_medical_records_processing_run_id
  ON public.medical_records(processing_run_id)
  WHERE processing_run_id IS NOT NULL;
