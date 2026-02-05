-- Function: get_record_conditions()
-- Get conditions for a medical record with their details
-- Drop first when return type changed (normalized_name -> icd_name_en/icd_name_ru)
DROP FUNCTION IF EXISTS public.get_record_conditions(uuid);

CREATE OR REPLACE FUNCTION public.get_record_conditions(p_record_id uuid)
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
  condition_notes text
)
LANGUAGE sql
STABLE
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

COMMENT ON FUNCTION public.get_record_conditions(uuid) IS
  'Get conditions linked to a medical record with condition details.';
