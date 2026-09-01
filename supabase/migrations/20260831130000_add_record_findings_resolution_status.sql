-- Replace the zero sentinel on record_findings with an explicit resolution status.
--
-- A finding that a later record resolved was written with `size_mm = 0, count = 0`, and every
-- reader treated those zeros as "resolved". Both columns are unconstrained by the database, so a
-- real measured zero was indistinguishable from the sentinel and silently disappeared from the
-- active list.
ALTER TABLE public.record_findings
  ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'observed';

DO $$
BEGIN
  ALTER TABLE public.record_findings
    ADD CONSTRAINT record_findings_resolution_status_check
    CHECK (resolution_status IN ('observed', 'resolved'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.record_findings.resolution_status IS
  'Whether this row records a finding observed in the document (''observed'') or the resolution of an earlier one (''resolved''). Replaces the size_mm/count zero sentinel.';

CREATE INDEX IF NOT EXISTS idx_record_findings_resolution_status
  ON public.record_findings(resolution_status);

-- Backfill only rows carrying independent evidence of resolution: the `Resolved: ` anchor that
-- the resolution writer produces. Deliberately NOT backfilled from `size_mm = 0 OR count = 0` --
-- that heuristic is exactly the ambiguity this column exists to remove, and it would permanently
-- relabel a user-entered finding with a legitimate zero. Ambiguous historical rows stay
-- 'observed', which means they reappear as active findings; erring towards showing a finding that
-- was resolved beats hiding one that was not.
UPDATE public.record_findings
SET resolution_status = 'resolved'
WHERE resolution_status = 'observed'
  AND source_anchor LIKE 'Resolved: %';
