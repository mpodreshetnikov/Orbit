-- Add canonical reference range columns to record_observations
-- These store ref ranges converted to canonical units

ALTER TABLE public.record_observations
ADD COLUMN IF NOT EXISTS ref_range_low_canonical numeric,
ADD COLUMN IF NOT EXISTS ref_range_high_canonical numeric;

-- Add comment
COMMENT ON COLUMN public.record_observations.ref_range_low_canonical IS 'Reference range low converted to canonical units';
COMMENT ON COLUMN public.record_observations.ref_range_high_canonical IS 'Reference range high converted to canonical units';

-- Drop existing function first (return type changed)
DROP FUNCTION IF EXISTS public.get_record_observations(uuid);

-- Recreate get_record_observations function with new columns
CREATE FUNCTION public.get_record_observations(p_record_id uuid)
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
  ref_range_low_canonical numeric,
  ref_range_high_canonical numeric,
  status text,
  is_llm_extracted boolean,
  is_user_verified boolean,
  confidence numeric,
  created_at timestamptz,
  updated_at timestamptz,
  catalog_name_ru text,
  catalog_name_en text,
  catalog_canonical_unit text
) LANGUAGE sql SECURITY DEFINER AS $$
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
    ro.ref_range_low_canonical,
    ro.ref_range_high_canonical,
    ro.status::text,
    ro.is_llm_extracted,
    ro.is_user_verified,
    ro.confidence,
    ro.created_at,
    ro.updated_at,
    oc.name_ru,
    oc.name_en,
    oc.canonical_unit
  FROM public.record_observations ro
  LEFT JOIN public.observation_catalog oc ON ro.catalog_id = oc.id
  WHERE ro.record_id = p_record_id
  ORDER BY ro.created_at DESC;
$$;
