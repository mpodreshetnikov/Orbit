-- Function: get_record_findings()
-- Get findings for a medical record with catalog details

CREATE OR REPLACE FUNCTION public.get_record_findings(p_record_id uuid)
RETURNS TABLE (
  id uuid,
  person_id uuid,
  record_id uuid,
  finding_type_id uuid,
  finding_code text,
  finding_type_text text,
  body_site_id uuid,
  site_code text,
  body_site_text text,
  size_mm numeric,
  count integer,
  severity text,
  laterality text,
  morphology text,
  description text,
  histology text,
  finding_date date,
  source_anchor text,
  is_llm_extracted boolean,
  is_user_verified boolean,
  confidence numeric,
  created_at timestamptz,
  catalog_finding_name_ru text,
  catalog_finding_name_en text,
  catalog_site_name_ru text,
  catalog_site_name_en text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Validate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    rf.id,
    rf.person_id,
    rf.record_id,
    rf.finding_type_id,
    rf.finding_code,
    rf.finding_type_text,
    rf.body_site_id,
    rf.site_code,
    rf.body_site_text,
    rf.size_mm,
    rf.count,
    rf.severity,
    rf.laterality,
    rf.morphology,
    rf.description,
    rf.histology,
    rf.finding_date,
    rf.source_anchor,
    rf.is_llm_extracted,
    rf.is_user_verified,
    rf.confidence,
    rf.created_at,
    ftc.name_ru AS catalog_finding_name_ru,
    ftc.name_en AS catalog_finding_name_en,
    bsc.name_ru AS catalog_site_name_ru,
    bsc.name_en AS catalog_site_name_en
  FROM public.record_findings rf
  LEFT JOIN public.finding_type_catalog ftc ON ftc.id = rf.finding_type_id
  LEFT JOIN public.body_site_catalog bsc ON bsc.id = rf.body_site_id
  WHERE rf.record_id = p_record_id
  ORDER BY rf.created_at;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.get_record_findings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_record_findings(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_record_findings(uuid) IS
  'Get findings for a medical record with catalog details (finding type and body site names).';
