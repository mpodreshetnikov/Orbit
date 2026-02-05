-- Function: get_person_conditions_with_history()
-- Get all conditions for a person with mention history
-- Drop first when return type changed (normalized_name -> icd_name_en/icd_name_ru)
DROP FUNCTION IF EXISTS public.get_person_conditions_with_history(uuid);

CREATE OR REPLACE FUNCTION public.get_person_conditions_with_history(p_person_id uuid)
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
LANGUAGE sql
STABLE
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

COMMENT ON FUNCTION public.get_person_conditions_with_history(uuid) IS
  'Get all conditions for a person with mention count and date range from linked records.';
