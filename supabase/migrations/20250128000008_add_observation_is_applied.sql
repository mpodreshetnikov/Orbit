-- ============================================================================
-- ADD is_applied COLUMN TO RECORD OBSERVATIONS
-- Custom observations (no obs_code) default to false, requiring explicit user action
-- Catalog observations default to true
-- ============================================================================

-- Add is_applied column with default true
ALTER TABLE public.record_observations 
  ADD COLUMN IF NOT EXISTS is_applied boolean NOT NULL DEFAULT true;

-- Update existing custom observations (no obs_code) to is_applied = false
-- Only if they haven't been verified by user yet
UPDATE public.record_observations 
SET is_applied = false 
WHERE obs_code IS NULL AND is_user_verified = false;

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_record_observations_is_applied 
  ON public.record_observations(is_applied);

-- ============================================================================
-- UPDATE get_record_observations FUNCTION TO INCLUDE is_applied
-- Must drop first because we're changing the return type
-- ============================================================================
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
  -- Catalog fields
  catalog_name_ru text,
  catalog_name_en text,
  catalog_canonical_unit text
) AS $$
BEGIN
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
    oc.canonical_unit AS catalog_canonical_unit
  FROM public.record_observations ro
  LEFT JOIN public.observation_catalog oc ON oc.id = ro.catalog_id
  WHERE ro.record_id = p_record_id
  ORDER BY ro.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
