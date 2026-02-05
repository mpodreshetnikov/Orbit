-- Function: get_record_observations()
-- Get observations for a medical record with catalog details
-- Drop first when return type may have changed (e.g. is_applied, default_ref columns)
DROP FUNCTION IF EXISTS public.get_record_observations(uuid);

CREATE OR REPLACE FUNCTION public.get_record_observations(p_record_id uuid)
RETURNS TABLE (
  id uuid,
  record_id uuid,
  catalog_id uuid,
  obs_code text,
  obs_name text,
  value_numeric numeric,
  value_text text,
  unit text,
  value_canonical numeric,
  unit_canonical text,
  ref_range_text text,
  ref_range_low numeric,
  ref_range_high numeric,
  status text,
  is_llm_extracted boolean,
  is_user_verified boolean,
  is_applied boolean,
  confidence numeric,
  created_at timestamptz,
  catalog_name_ru text,
  catalog_name_en text,
  catalog_canonical_unit text,
  default_ref_low numeric,
  default_ref_high numeric
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
    ro.id,
    ro.record_id,
    ro.catalog_id,
    ro.obs_code,
    ro.obs_name,
    ro.value_numeric,
    ro.value_text,
    ro.unit,
    ro.value_canonical,
    ro.unit_canonical,
    ro.ref_range_text,
    ro.ref_range_low,
    ro.ref_range_high,
    ro.status,
    ro.is_llm_extracted,
    ro.is_user_verified,
    ro.is_applied,
    ro.confidence,
    ro.created_at,
    oc.name_ru AS catalog_name_ru,
    oc.name_en AS catalog_name_en,
    oc.canonical_unit AS catalog_canonical_unit,
    oc.default_ref_low,
    oc.default_ref_high
  FROM public.record_observations ro
  LEFT JOIN public.observation_catalog oc ON oc.id = ro.catalog_id
  WHERE ro.record_id = p_record_id
  ORDER BY ro.created_at;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.get_record_observations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_record_observations(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_record_observations(uuid) IS
  'Get observations for a medical record with catalog details (names, canonical unit).';
