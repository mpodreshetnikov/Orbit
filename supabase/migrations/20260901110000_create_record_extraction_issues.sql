-- What the extraction had to correct in order to save the rest of the document.
--
-- Per-value validation already keeps one bad attribute from rejecting a whole insert: an
-- out-of-vocabulary enumeration falls back to the column's default, an unparseable date becomes
-- null, and the forty good lab values in the same document survive. But the correction itself
-- went nowhere. It was counted in a log line and dropped, so nobody reviewing the record could
-- see that a severity had been guessed at or a date discarded — and the review screen is exactly
-- where a person can still fix it.
--
-- This is the record's own data, under the same row-level security as the values it describes,
-- rather than telemetry: `received` holds what the model actually wrote, which is content from
-- the patient's document and must never reach a log.

CREATE TABLE IF NOT EXISTS public.record_extraction_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.medical_records(id) ON DELETE CASCADE,
  -- Which kind of entity the correction applied to: 'observation', 'finding', 'condition'.
  entity_kind text NOT NULL,
  -- The attribute, as the extraction names it: 'finding.severity', 'observation.status'. Null
  -- when the whole entity was dropped rather than one of its values corrected.
  field text,
  -- What the model wrote, truncated. Null when the value was absent rather than wrong.
  received text,
  -- What was done about it, so the reader knows whether anything was lost.
  resolution text NOT NULL CHECK (resolution IN ('replaced_with_default', 'dropped')),
  -- What replaced it, when something did.
  applied_fallback text,
  -- Why, in the extraction's own words: 'missing analyte label'. Carries no document content.
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_record_extraction_issues_record
  ON public.record_extraction_issues(record_id);

ALTER TABLE public.record_extraction_issues ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.record_extraction_issues IS
  'Value-level corrections the extraction made to save the rest of a document, shown on the review screen so a person can still fix them.';
COMMENT ON COLUMN public.record_extraction_issues.received IS
  'What the model wrote for this field, truncated. Document content: it belongs here, under RLS, and never in a log.';

DROP POLICY IF EXISTS "record_extraction_issues_select" ON public.record_extraction_issues;
CREATE POLICY "record_extraction_issues_select" ON public.record_extraction_issues
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_extraction_issues_insert" ON public.record_extraction_issues;
CREATE POLICY "record_extraction_issues_insert" ON public.record_extraction_issues
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_extraction_issues_delete" ON public.record_extraction_issues;
CREATE POLICY "record_extraction_issues_delete" ON public.record_extraction_issues
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );
