-- Function: get_record_conditions()
-- Get condition mentions for a medical record: materialised links, and proposals awaiting review
-- Drop first when the return type changed (is_proposal added with the proposal path;
-- supporting_obs_code and review_decision added with lab-driven resolution proposals)
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
  is_proposal boolean,
  supporting_obs_code text,
  review_decision text
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
    cr.condition_id IS NULL,
    -- What a proposed closure rests on, and whether anyone has ruled on it. A reader that cannot
    -- see the analyte cannot re-check the claim against the observations a person has since
    -- corrected, and a reader that cannot see the decision cannot tell a rejection from a
    -- proposal nobody has opened.
    cr.supporting_obs_code,
    cr.review_decision
  FROM public.condition_records cr
  LEFT JOIN public.conditions c ON c.id = cr.condition_id
  WHERE cr.record_id = p_record_id
    AND (c.id IS NULL OR c.deleted_at IS NULL)
  ORDER BY COALESCE(c.name, cr.proposed_name);
$$;

COMMENT ON FUNCTION public.get_record_conditions(uuid) IS
  'Get condition mentions for a medical record: materialised links with their condition details, and proposals that name a condition not yet in the chart.';
