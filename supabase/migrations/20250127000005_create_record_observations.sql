-- ============================================================================
-- RECORD OBSERVATIONS TABLE
-- Stores extracted lab values/observations from medical records
-- Each observation links to a medical_record and optionally to observation_catalog
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.record_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to the source medical record
  record_id uuid NOT NULL REFERENCES public.medical_records(id) ON DELETE CASCADE,
  
  -- Link to observation catalog (optional - may be null for unrecognized observations)
  catalog_id uuid REFERENCES public.observation_catalog(id) ON DELETE SET NULL,
  
  -- Observation identification
  obs_code text, -- Matches observation_catalog.obs_code if catalog_id is set
  obs_name text NOT NULL, -- Display name as extracted from document
  
  -- Value and unit as extracted from document
  value_numeric numeric, -- Parsed numeric value (may be null for non-numeric)
  value_text text, -- Original text value (e.g., "14.2", "положительный", "1:256")
  unit text, -- Unit as written in document
  
  -- Normalized value (converted to canonical unit if catalog_id is set)
  value_canonical numeric, -- Value converted to observation_catalog.canonical_unit
  unit_canonical text, -- The canonical unit from catalog
  
  -- Reference range as extracted from document
  ref_range_text text, -- Original reference range text (e.g., "12.0-16.0")
  ref_range_low numeric,
  ref_range_high numeric,
  
  -- Status relative to reference range
  status text CHECK (status IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'unknown')),
  
  -- Extraction metadata
  is_llm_extracted boolean NOT NULL DEFAULT true, -- Was this extracted by LLM?
  is_user_verified boolean NOT NULL DEFAULT false, -- Has user reviewed/confirmed?
  confidence numeric, -- LLM confidence score (0-1)
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.record_observations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read observations for records they can access
CREATE POLICY "Users can read record observations"
  ON public.record_observations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Users can insert observations for records they can access
CREATE POLICY "Users can insert record observations"
  ON public.record_observations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Users can update observations for records they can access
CREATE POLICY "Users can update record observations"
  ON public.record_observations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Users can delete observations for records they can access
CREATE POLICY "Users can delete record observations"
  ON public.record_observations FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_record_observations_record_id 
  ON public.record_observations(record_id);
CREATE INDEX IF NOT EXISTS idx_record_observations_catalog_id 
  ON public.record_observations(catalog_id);
CREATE INDEX IF NOT EXISTS idx_record_observations_obs_code 
  ON public.record_observations(obs_code);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_record_observations_updated_at
  BEFORE UPDATE ON public.record_observations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTION: Get observations for a medical record with catalog details
-- ============================================================================
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
