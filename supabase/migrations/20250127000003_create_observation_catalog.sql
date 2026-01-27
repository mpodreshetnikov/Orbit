-- ============================================================================
-- OBSERVATION CATALOG TABLE
-- Reference table for standardized medical observations/lab tests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.observation_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Unique code for the observation (e.g., "vitamin_b12", "ferritin")
  obs_code text NOT NULL UNIQUE,
  
  -- Localized names
  name_ru text NOT NULL,
  name_en text NOT NULL,
  
  -- Canonical unit for storing values (all values converted to this unit)
  canonical_unit text NOT NULL,
  
  -- Synonyms for matching from OCR/LLM extraction (lowercase for matching)
  synonyms_ru text[] NOT NULL DEFAULT '{}',
  synonyms_en text[] NOT NULL DEFAULT '{}',
  
  -- Unit conversion rules: { "unit": { "factor_to_canonical": number, "formula_to_canonical"?: string } }
  accepted_units jsonb NOT NULL DEFAULT '{}',
  
  -- Optional notes about the observation
  notes text,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (read-only for authenticated users)
ALTER TABLE public.observation_catalog ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users can read the catalog
CREATE POLICY "Authenticated users can read observation catalog"
  ON public.observation_catalog FOR SELECT TO authenticated
  USING (true);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_observation_catalog_obs_code 
  ON public.observation_catalog(obs_code);

-- GIN indexes for array searches (synonym matching)
CREATE INDEX IF NOT EXISTS idx_observation_catalog_synonyms_ru 
  ON public.observation_catalog USING GIN(synonyms_ru);
CREATE INDEX IF NOT EXISTS idx_observation_catalog_synonyms_en 
  ON public.observation_catalog USING GIN(synonyms_en);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_observation_catalog_updated_at
  BEFORE UPDATE ON public.observation_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTION: Find observation by synonym
-- Returns the obs_code that matches a given text (case-insensitive)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_observation_by_synonym(
  p_text text,
  p_lang text DEFAULT 'en'
)
RETURNS text AS $$
DECLARE
  v_normalized text;
  v_result text;
BEGIN
  -- Normalize input: lowercase, trim
  v_normalized := lower(trim(p_text));
  
  IF p_lang = 'ru' THEN
    SELECT obs_code INTO v_result
    FROM public.observation_catalog
    WHERE v_normalized = ANY(synonyms_ru)
       OR lower(name_ru) = v_normalized
    LIMIT 1;
  ELSE
    SELECT obs_code INTO v_result
    FROM public.observation_catalog
    WHERE v_normalized = ANY(synonyms_en)
       OR lower(name_en) = v_normalized
    LIMIT 1;
  END IF;
  
  -- If not found in specified language, try the other
  IF v_result IS NULL THEN
    IF p_lang = 'ru' THEN
      SELECT obs_code INTO v_result
      FROM public.observation_catalog
      WHERE v_normalized = ANY(synonyms_en)
         OR lower(name_en) = v_normalized
      LIMIT 1;
    ELSE
      SELECT obs_code INTO v_result
      FROM public.observation_catalog
      WHERE v_normalized = ANY(synonyms_ru)
         OR lower(name_ru) = v_normalized
      LIMIT 1;
    END IF;
  END IF;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- HELPER FUNCTION: Convert observation value to canonical unit
-- ============================================================================
CREATE OR REPLACE FUNCTION public.convert_to_canonical_unit(
  p_obs_code text,
  p_value numeric,
  p_unit text
)
RETURNS numeric AS $$
DECLARE
  v_accepted_units jsonb;
  v_unit_config jsonb;
  v_factor numeric;
BEGIN
  -- Get accepted_units for this observation
  SELECT accepted_units INTO v_accepted_units
  FROM public.observation_catalog
  WHERE obs_code = p_obs_code;
  
  IF v_accepted_units IS NULL THEN
    RAISE EXCEPTION 'Unknown observation code: %', p_obs_code;
  END IF;
  
  -- Get config for the provided unit
  v_unit_config := v_accepted_units -> p_unit;
  
  IF v_unit_config IS NULL THEN
    RAISE EXCEPTION 'Unknown unit "%" for observation "%"', p_unit, p_obs_code;
  END IF;
  
  -- Get conversion factor
  v_factor := (v_unit_config ->> 'factor_to_canonical')::numeric;
  
  IF v_factor IS NULL THEN
    -- Has formula instead of factor - return NULL to indicate manual conversion needed
    RETURN NULL;
  END IF;
  
  RETURN p_value * v_factor;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- SEED DATA: Initial observation catalog
-- ============================================================================
INSERT INTO public.observation_catalog (obs_code, name_ru, name_en, canonical_unit, synonyms_ru, synonyms_en, accepted_units, notes)
VALUES
  -- Vitamin B12
  (
    'vitamin_b12',
    'Витамин B12 (кобаламин)',
    'Vitamin B12 (cobalamin)',
    'pmol/L',
    ARRAY['b12', 'витамин b12', 'кобаламин', 'цианокобаламин'],
    ARRAY['vitamin b12', 'b12', 'cobalamin', 'cyanocobalamin'],
    '{"pmol/L": {"factor_to_canonical": 1}, "pg/mL": {"factor_to_canonical": 0.738}}'::jsonb,
    NULL
  ),
  
  -- Ferritin
  (
    'ferritin',
    'Ферритин',
    'Ferritin',
    'ug/L',
    ARRAY['ферритин'],
    ARRAY['ferritin'],
    '{"ug/L": {"factor_to_canonical": 1}, "ng/mL": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- Hemoglobin
  (
    'hemoglobin',
    'Гемоглобин',
    'Hemoglobin',
    'g/L',
    ARRAY['hb', 'hgb', 'гемоглобин'],
    ARRAY['hb', 'hgb', 'hemoglobin'],
    '{"g/L": {"factor_to_canonical": 1}, "g/dL": {"factor_to_canonical": 10}}'::jsonb,
    NULL
  ),
  
  -- MCV
  (
    'mcv',
    'MCV (средний объём эритроцита)',
    'MCV',
    'fL',
    ARRAY['mcv'],
    ARRAY['mcv'],
    '{"fL": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- MCH
  (
    'mch',
    'MCH (среднее содержание Hb в эритроците)',
    'MCH',
    'pg',
    ARRAY['mch'],
    ARRAY['mch'],
    '{"pg": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- RDW
  (
    'rdw',
    'RDW',
    'RDW',
    '%',
    ARRAY['rdw'],
    ARRAY['rdw'],
    '{"%": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- Serum Iron
  (
    'serum_iron',
    'Железо сывороточное',
    'Serum iron',
    'umol/L',
    ARRAY['железо', 'fe', 'сывороточное железо'],
    ARRAY['iron', 'fe', 'serum iron'],
    '{"umol/L": {"factor_to_canonical": 1}, "ug/dL": {"factor_to_canonical": 0.179}}'::jsonb,
    NULL
  ),
  
  -- Transferrin
  (
    'transferrin',
    'Трансферрин',
    'Transferrin',
    'g/L',
    ARRAY['трансферрин'],
    ARRAY['transferrin'],
    '{"g/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.01}}'::jsonb,
    NULL
  ),
  
  -- TIBC
  (
    'tibc',
    'ОЖСС (TIBC)',
    'TIBC',
    'umol/L',
    ARRAY['ожсс', 'tibc', 'общая железосвязывающая способность'],
    ARRAY['tibc', 'total iron binding capacity'],
    '{"umol/L": {"factor_to_canonical": 1}, "ug/dL": {"factor_to_canonical": 0.179}}'::jsonb,
    NULL
  ),
  
  -- TSAT
  (
    'tsat',
    'Насыщение трансферрина (TSAT)',
    'Transferrin saturation (TSAT)',
    '%',
    ARRAY['tsat', 'насыщение трансферрина'],
    ARRAY['tsat', 'transferrin saturation'],
    '{"%": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- CRP
  (
    'crp',
    'С-реактивный белок (CRP)',
    'C-reactive protein (CRP)',
    'mg/L',
    ARRAY['срб', 'crp', 'с-реактивный белок'],
    ARRAY['crp', 'c-reactive protein'],
    '{"mg/L": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- Glucose
  (
    'glucose',
    'Глюкоза',
    'Glucose',
    'mmol/L',
    ARRAY['глюкоза', 'glucose'],
    ARRAY['glucose'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.05556}}'::jsonb,
    'mg/dL → mmol/L: divide by 18 (≈ multiply by 0.05556)'
  ),
  
  -- HbA1c
  (
    'hba1c',
    'HbA1c (гликированный гемоглобин)',
    'HbA1c',
    '%',
    ARRAY['hba1c', 'гликированный гемоглобин', 'a1c'],
    ARRAY['hba1c', 'a1c'],
    '{"%": {"factor_to_canonical": 1}, "mmol/mol": {"formula_to_canonical": "percent = (mmol_per_mol * 0.09148) + 2.152"}}'::jsonb,
    NULL
  ),
  
  -- ALT
  (
    'alt',
    'АЛТ',
    'ALT',
    'U/L',
    ARRAY['алт', 'alt'],
    ARRAY['alt'],
    '{"U/L": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- AST
  (
    'ast',
    'АСТ',
    'AST',
    'U/L',
    ARRAY['аст', 'ast'],
    ARRAY['ast'],
    '{"U/L": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- ALP
  (
    'alp',
    'ЩФ (ALP)',
    'ALP',
    'U/L',
    ARRAY['щф', 'alp', 'alkaline phosphatase'],
    ARRAY['alp', 'alkaline phosphatase'],
    '{"U/L": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- GGT
  (
    'ggt',
    'ГГТ (GGT)',
    'GGT',
    'U/L',
    ARRAY['ггт', 'ggt', 'гамма-гт'],
    ARRAY['ggt', 'gamma-gt'],
    '{"U/L": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- Bilirubin Total
  (
    'bilirubin_total',
    'Билирубин общий',
    'Total bilirubin',
    'umol/L',
    ARRAY['билирубин общий', 'общий билирубин'],
    ARRAY['total bilirubin'],
    '{"umol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 17.1}}'::jsonb,
    NULL
  ),
  
  -- Creatinine
  (
    'creatinine',
    'Креатинин',
    'Creatinine',
    'umol/L',
    ARRAY['креатинин', 'creatinine'],
    ARRAY['creatinine'],
    '{"umol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 88.4}}'::jsonb,
    NULL
  ),
  
  -- Urea
  (
    'urea',
    'Мочевина',
    'Urea',
    'mmol/L',
    ARRAY['мочевина', 'urea'],
    ARRAY['urea'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.1665}}'::jsonb,
    NULL
  ),
  
  -- TSH
  (
    'tsh',
    'ТТГ (TSH)',
    'TSH',
    'mIU/L',
    ARRAY['ттг', 'tsh'],
    ARRAY['tsh'],
    '{"mIU/L": {"factor_to_canonical": 1}}'::jsonb,
    NULL
  ),
  
  -- Vitamin D 25(OH)
  (
    'vitamin_d_25oh',
    '25(OH) витамин D',
    '25(OH) Vitamin D',
    'nmol/L',
    ARRAY['25(oh)d', 'витамин d', 'кальцидол', '25-гидроксивитамин d'],
    ARRAY['25(oh)d', 'vitamin d', 'calcidiol', '25-hydroxyvitamin d'],
    '{"nmol/L": {"factor_to_canonical": 1}, "ng/mL": {"factor_to_canonical": 2.5}}'::jsonb,
    NULL
  ),
  
  -- Total Cholesterol
  (
    'cholesterol_total',
    'Холестерин общий',
    'Total cholesterol',
    'mmol/L',
    ARRAY['холестерин', 'общий холестерин', 'cholesterol total', 'tc'],
    ARRAY['cholesterol', 'total cholesterol', 'tc'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.0259}}'::jsonb,
    NULL
  ),
  
  -- LDL-C
  (
    'ldl_c',
    'ЛПНП (LDL-C)',
    'LDL-C',
    'mmol/L',
    ARRAY['лпнп', 'ldl', 'ldl-c'],
    ARRAY['ldl', 'ldl-c'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.0259}}'::jsonb,
    NULL
  ),
  
  -- HDL-C
  (
    'hdl_c',
    'ЛПВП (HDL-C)',
    'HDL-C',
    'mmol/L',
    ARRAY['лпвп', 'hdl', 'hdl-c'],
    ARRAY['hdl', 'hdl-c'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.0259}}'::jsonb,
    NULL
  ),
  
  -- Triglycerides
  (
    'triglycerides',
    'Триглицериды',
    'Triglycerides',
    'mmol/L',
    ARRAY['триглицериды', 'tg'],
    ARRAY['triglycerides', 'tg'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.01129}}'::jsonb,
    NULL
  ),
  
  -- Total Calcium
  (
    'calcium_total',
    'Кальций общий',
    'Total calcium',
    'mmol/L',
    ARRAY['кальций', 'calcium', 'ca'],
    ARRAY['calcium', 'ca'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.25}}'::jsonb,
    NULL
  ),
  
  -- Magnesium
  (
    'magnesium',
    'Магний',
    'Magnesium',
    'mmol/L',
    ARRAY['магний', 'mg', 'magnesium'],
    ARRAY['magnesium', 'mg'],
    '{"mmol/L": {"factor_to_canonical": 1}, "mg/dL": {"factor_to_canonical": 0.4114}}'::jsonb,
    NULL
  )
ON CONFLICT (obs_code) DO UPDATE SET
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  canonical_unit = EXCLUDED.canonical_unit,
  synonyms_ru = EXCLUDED.synonyms_ru,
  synonyms_en = EXCLUDED.synonyms_en,
  accepted_units = EXCLUDED.accepted_units,
  notes = EXCLUDED.notes,
  updated_at = now();
