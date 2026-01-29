-- ============================================================================
-- ADD DEFAULT REFERENCE RANGES TO OBSERVATION CATALOG
-- Provides standard reference ranges for each observation type
-- Used when specific document reference ranges are not available
-- ============================================================================

BEGIN;

-- Add columns for default reference ranges
ALTER TABLE public.observation_catalog 
  ADD COLUMN IF NOT EXISTS default_ref_low numeric,
  ADD COLUMN IF NOT EXISTS default_ref_high numeric;

-- Add comment explaining the columns
COMMENT ON COLUMN public.observation_catalog.default_ref_low IS 'Default lower bound of reference range (in canonical units)';
COMMENT ON COLUMN public.observation_catalog.default_ref_high IS 'Default upper bound of reference range (in canonical units)';

-- ============================================================================
-- SEED DEFAULT REFERENCE RANGES
-- Values are in canonical units as defined in each observation's canonical_unit
-- Based on standard adult reference ranges
-- ============================================================================

-- Vitamins
UPDATE public.observation_catalog SET default_ref_low = 148, default_ref_high = 738 WHERE obs_code = 'vitamin_b12';  -- pmol/L
UPDATE public.observation_catalog SET default_ref_low = 75, default_ref_high = 150 WHERE obs_code = 'vitamin_d_25oh';  -- nmol/L

-- Iron metabolism
UPDATE public.observation_catalog SET default_ref_low = 30, default_ref_high = 300 WHERE obs_code = 'ferritin';  -- ug/L
UPDATE public.observation_catalog SET default_ref_low = 10, default_ref_high = 30 WHERE obs_code = 'serum_iron';  -- umol/L
UPDATE public.observation_catalog SET default_ref_low = 2.0, default_ref_high = 3.6 WHERE obs_code = 'transferrin';  -- g/L
UPDATE public.observation_catalog SET default_ref_low = 45, default_ref_high = 72 WHERE obs_code = 'tibc';  -- umol/L
UPDATE public.observation_catalog SET default_ref_low = 20, default_ref_high = 50 WHERE obs_code = 'tsat';  -- %

-- Complete blood count
UPDATE public.observation_catalog SET default_ref_low = 120, default_ref_high = 170 WHERE obs_code = 'hemoglobin';  -- g/L
UPDATE public.observation_catalog SET default_ref_low = 80, default_ref_high = 100 WHERE obs_code = 'mcv';  -- fL
UPDATE public.observation_catalog SET default_ref_low = 27, default_ref_high = 33 WHERE obs_code = 'mch';  -- pg
UPDATE public.observation_catalog SET default_ref_low = 11.5, default_ref_high = 14.5 WHERE obs_code = 'rdw';  -- %

-- Inflammation
UPDATE public.observation_catalog SET default_ref_low = 0, default_ref_high = 5 WHERE obs_code = 'crp';  -- mg/L

-- Metabolic
UPDATE public.observation_catalog SET default_ref_low = 3.9, default_ref_high = 5.6 WHERE obs_code = 'glucose';  -- mmol/L
UPDATE public.observation_catalog SET default_ref_low = 4.0, default_ref_high = 5.6 WHERE obs_code = 'hba1c';  -- %

-- Liver function
UPDATE public.observation_catalog SET default_ref_low = 7, default_ref_high = 56 WHERE obs_code = 'alt';  -- U/L
UPDATE public.observation_catalog SET default_ref_low = 10, default_ref_high = 40 WHERE obs_code = 'ast';  -- U/L
UPDATE public.observation_catalog SET default_ref_low = 44, default_ref_high = 147 WHERE obs_code = 'alp';  -- U/L
UPDATE public.observation_catalog SET default_ref_low = 9, default_ref_high = 48 WHERE obs_code = 'ggt';  -- U/L
UPDATE public.observation_catalog SET default_ref_low = 3.4, default_ref_high = 17.1 WHERE obs_code = 'bilirubin_total';  -- umol/L

-- Kidney function
UPDATE public.observation_catalog SET default_ref_low = 59, default_ref_high = 104 WHERE obs_code = 'creatinine';  -- umol/L
UPDATE public.observation_catalog SET default_ref_low = 2.5, default_ref_high = 7.1 WHERE obs_code = 'urea';  -- mmol/L

-- Thyroid
UPDATE public.observation_catalog SET default_ref_low = 0.4, default_ref_high = 4.0 WHERE obs_code = 'tsh';  -- mIU/L

-- Lipid panel
UPDATE public.observation_catalog SET default_ref_low = 3.1, default_ref_high = 5.2 WHERE obs_code = 'cholesterol_total';  -- mmol/L
UPDATE public.observation_catalog SET default_ref_low = 0, default_ref_high = 3.4 WHERE obs_code = 'ldl_c';  -- mmol/L
UPDATE public.observation_catalog SET default_ref_low = 1.0, default_ref_high = 1.5 WHERE obs_code = 'hdl_c';  -- mmol/L
UPDATE public.observation_catalog SET default_ref_low = 0.5, default_ref_high = 1.7 WHERE obs_code = 'triglycerides';  -- mmol/L

-- Minerals
UPDATE public.observation_catalog SET default_ref_low = 2.1, default_ref_high = 2.55 WHERE obs_code = 'calcium_total';  -- mmol/L
UPDATE public.observation_catalog SET default_ref_low = 0.66, default_ref_high = 1.07 WHERE obs_code = 'magnesium';  -- mmol/L

-- Eye observations
UPDATE public.observation_catalog SET default_ref_low = 0.8, default_ref_high = 1.2 WHERE obs_code = 'visual_acuity_od';  -- decimal
UPDATE public.observation_catalog SET default_ref_low = 0.8, default_ref_high = 1.2 WHERE obs_code = 'visual_acuity_os';  -- decimal
UPDATE public.observation_catalog SET default_ref_low = 10, default_ref_high = 21 WHERE obs_code = 'iop_od';  -- mmHg
UPDATE public.observation_catalog SET default_ref_low = 10, default_ref_high = 21 WHERE obs_code = 'iop_os';  -- mmHg
UPDATE public.observation_catalog SET default_ref_low = -0.5, default_ref_high = 0.5 WHERE obs_code = 'refraction_sph_od';  -- D (ideal is 0)
UPDATE public.observation_catalog SET default_ref_low = -0.5, default_ref_high = 0.5 WHERE obs_code = 'refraction_sph_os';  -- D (ideal is 0)

-- ============================================================================
-- UPDATE get_record_observations FUNCTION TO INCLUDE DEFAULT REF RANGES
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
  catalog_canonical_unit text,
  -- Default reference ranges from catalog
  default_ref_low numeric,
  default_ref_high numeric
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
    oc.canonical_unit AS catalog_canonical_unit,
    oc.default_ref_low,
    oc.default_ref_high
  FROM public.record_observations ro
  LEFT JOIN public.observation_catalog oc ON oc.id = ro.catalog_id
  WHERE ro.record_id = p_record_id
  ORDER BY ro.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
