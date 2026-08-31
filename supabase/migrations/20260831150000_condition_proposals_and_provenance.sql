-- Conditions reach the patient's chart only after a human approves them.
--
-- Extraction used to call resolveOrCreateCondition directly, so a model's reading of a document
-- created rows in `public.conditions` before anyone had reviewed the record. The chart gained
-- diagnoses nobody had approved, and deleting the record's mention left the condition behind.
--
-- Two changes make the approval path possible. A condition mention can now be a *proposal* --
-- scoped to the record, carrying the proposed name and code, linked to no condition yet -- and
-- `conditions` itself records where a row came from, which it previously could not say at all.

-- 1. Provenance on the condition itself.
--
-- Existing rows take the conservative values: nothing already in the database is claimed to be
-- LLM-created, and nothing is left looking unreviewed. A later cleanup of unverified LLM rows can
-- therefore only ever touch rows created after this migration, which is the point -- an orphaned
-- condition and a genuine user-created one are indistinguishable in the current data.
ALTER TABLE public.conditions
  ADD COLUMN IF NOT EXISTS is_llm_extracted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_user_verified boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.conditions.is_llm_extracted IS
  'True when this condition was materialised from an LLM proposal. Rows predating the proposal path default to false: their provenance is unknown and must not be assumed.';
COMMENT ON COLUMN public.conditions.is_user_verified IS
  'True once a person has approved this condition. Rows predating the proposal path default to true so no cleanup can sweep them up.';

-- 2. A mention that proposes a condition instead of pointing at one.
ALTER TABLE public.condition_records
  ALTER COLUMN condition_id DROP NOT NULL;

ALTER TABLE public.condition_records
  ADD COLUMN IF NOT EXISTS proposed_name text,
  ADD COLUMN IF NOT EXISTS proposed_icd_code text;

COMMENT ON COLUMN public.condition_records.proposed_name IS
  'The condition name as read from the document, on a mention that has not been materialised into public.conditions yet.';
COMMENT ON COLUMN public.condition_records.proposed_icd_code IS
  'The ICD-10 code as read from the document, on a proposal. Resolved against the catalogue when the proposal is accepted.';

-- Every row is one of the two: a link to a condition, or a proposal that names one.
DO $$
BEGIN
  ALTER TABLE public.condition_records
    ADD CONSTRAINT condition_records_link_or_proposal_check
    CHECK (
      condition_id IS NOT NULL
      OR (proposed_name IS NOT NULL AND btrim(proposed_name) <> '')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- UNIQUE(condition_id, record_id) does not constrain proposals, because NULLs never collide.
-- One proposal per name per record keeps a re-run from stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_condition_records_unique_proposal
  ON public.condition_records(record_id, lower(btrim(proposed_name)))
  WHERE condition_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_condition_records_proposals
  ON public.condition_records(record_id)
  WHERE condition_id IS NULL;

-- 3. The reader has to survive a mention with no condition behind it.
DROP FUNCTION IF EXISTS public.get_record_conditions(uuid);

CREATE FUNCTION public.get_record_conditions(p_record_id uuid)
RETURNS TABLE (
  id uuid,
  condition_id uuid,
  record_id uuid,
  status_in_record text,
  source_anchor text,
  confidence numeric,
  is_llm_extracted boolean,
  is_user_verified boolean,
  created_at timestamptz,
  condition_name text,
  condition_icd_name_en text,
  condition_icd_name_ru text,
  condition_code text,
  condition_current_status text,
  condition_onset_date date,
  condition_resolved_date date,
  condition_notes text,
  is_proposal boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    cr.id,
    cr.condition_id,
    cr.record_id,
    cr.status_in_record,
    cr.source_anchor,
    cr.confidence,
    cr.is_llm_extracted,
    cr.is_user_verified,
    cr.created_at,
    -- A proposal shows the name the document gave it; there is no condition row to read yet.
    COALESCE(c.name, cr.proposed_name),
    c.icd_name_en,
    c.icd_name_ru,
    COALESCE(c.code, cr.proposed_icd_code),
    c.current_status,
    c.onset_date,
    c.resolved_date,
    c.notes,
    cr.condition_id IS NULL
  FROM public.condition_records cr
  LEFT JOIN public.conditions c ON c.id = cr.condition_id
  WHERE cr.record_id = p_record_id
    AND (c.id IS NULL OR c.deleted_at IS NULL)
  ORDER BY COALESCE(c.name, cr.proposed_name);
$$;

COMMENT ON FUNCTION public.get_record_conditions(uuid) IS
  'Get condition mentions for a medical record: materialised links with their condition details, and proposals that name a condition not yet in the chart.';
