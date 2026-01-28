-- ============================================================================
-- ADD MULTILINGUAL ICD NAME COLUMNS TO CONDITIONS TABLE
-- ============================================================================

-- Rename normalized_name to icd_name_en for clarity
ALTER TABLE public.conditions 
  RENAME COLUMN normalized_name TO icd_name_en;

-- Add Russian ICD name column
ALTER TABLE public.conditions 
  ADD COLUMN icd_name_ru text;

-- Add index for ICD code lookups (partial index for non-null codes)
CREATE INDEX idx_conditions_code ON public.conditions(code) WHERE code IS NOT NULL;

-- ============================================================================
-- UPDATE HELPER FUNCTIONS TO USE NEW COLUMN NAMES
-- Must DROP first because return type is changing
-- ============================================================================

-- Drop old functions (return type is changing)
DROP FUNCTION IF EXISTS get_record_conditions(uuid);
DROP FUNCTION IF EXISTS get_person_conditions_with_history(uuid);

-- Recreate get_record_conditions with new column names
CREATE FUNCTION get_record_conditions(p_record_id uuid)
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
  -- From conditions table (updated column names)
  condition_name text,
  condition_icd_name_en text,
  condition_icd_name_ru text,
  condition_code text,
  condition_current_status text,
  condition_onset_date date,
  condition_resolved_date date,
  condition_notes text
)
LANGUAGE sql STABLE
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
    c.name,
    c.icd_name_en,
    c.icd_name_ru,
    c.code,
    c.current_status,
    c.onset_date,
    c.resolved_date,
    c.notes
  FROM public.condition_records cr
  JOIN public.conditions c ON c.id = cr.condition_id
  WHERE cr.record_id = p_record_id
    AND c.deleted_at IS NULL
  ORDER BY c.name;
$$;

-- Recreate get_person_conditions_with_history with new column names
CREATE FUNCTION get_person_conditions_with_history(p_person_id uuid)
RETURNS TABLE (
  id uuid,
  person_id uuid,
  name text,
  icd_name_en text,
  icd_name_ru text,
  code text,
  current_status text,
  onset_date date,
  resolved_date date,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  mention_count bigint,
  first_mentioned_date date,
  last_mentioned_date date
)
LANGUAGE sql STABLE
AS $$
  SELECT 
    c.id,
    c.person_id,
    c.name,
    c.icd_name_en,
    c.icd_name_ru,
    c.code,
    c.current_status,
    c.onset_date,
    c.resolved_date,
    c.notes,
    c.created_at,
    c.updated_at,
    COUNT(cr.id) as mention_count,
    MIN(mr.record_date) as first_mentioned_date,
    MAX(mr.record_date) as last_mentioned_date
  FROM public.conditions c
  LEFT JOIN public.condition_records cr ON cr.condition_id = c.id
  LEFT JOIN public.medical_records mr ON mr.id = cr.record_id
  WHERE c.person_id = p_person_id
    AND c.deleted_at IS NULL
  GROUP BY c.id
  ORDER BY c.current_status, c.name;
$$;
