-- ============================================================================
-- RECORD FINDINGS TABLE
-- Stores extracted medical findings from medical records (imaging, endoscopy, etc.)
-- Each finding links to a medical_record and optionally to finding/body site catalogs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.record_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to the person (denormalized for faster queries)
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  
  -- Link to the source medical record
  record_id uuid NOT NULL REFERENCES public.medical_records(id) ON DELETE CASCADE,
  
  -- Finding type - dual storage (code for LLM matching, ID for joins)
  finding_type_id uuid REFERENCES public.finding_type_catalog(id) ON DELETE SET NULL,
  finding_code text, -- Matches finding_type_catalog.finding_code if recognized
  finding_type_text text NOT NULL, -- Original name from document (required)
  
  -- Body site - dual storage (code for LLM matching, ID for joins)
  body_site_id uuid REFERENCES public.body_site_catalog(id) ON DELETE SET NULL,
  site_code text, -- Matches body_site_catalog.site_code if recognized
  body_site_text text, -- Original location from document
  
  -- Finding attributes
  size_mm numeric, -- Size in millimeters (nullable)
  count integer DEFAULT 1, -- Number of findings (default 1)
  severity text NOT NULL DEFAULT 'unknown' CHECK (severity IN ('mild', 'moderate', 'severe', 'unknown')),
  laterality text NOT NULL DEFAULT 'none' CHECK (laterality IN ('left', 'right', 'bilateral', 'none')),
  
  -- Additional details
  morphology text, -- Morphological description
  description text, -- Additional description
  histology text, -- Histology results if available
  
  -- Finding date (may differ from record date)
  finding_date date,
  
  -- Source anchor - exact quote from document (required for traceability)
  source_anchor text NOT NULL,
  
  -- Extraction metadata
  is_llm_extracted boolean NOT NULL DEFAULT true, -- Was this extracted by LLM?
  is_user_verified boolean NOT NULL DEFAULT false, -- Has user reviewed/confirmed?
  confidence numeric, -- LLM confidence score (0-1)
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.record_findings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read findings for records they can access
CREATE POLICY "Users can read record findings"
  ON public.record_findings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Users can insert findings for records they can access
CREATE POLICY "Users can insert record findings"
  ON public.record_findings FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Users can update findings for records they can access
CREATE POLICY "Users can update record findings"
  ON public.record_findings FOR UPDATE TO authenticated
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

-- RLS Policy: Users can delete findings for records they can access
CREATE POLICY "Users can delete record findings"
  ON public.record_findings FOR DELETE TO authenticated
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
CREATE INDEX IF NOT EXISTS idx_record_findings_record_id 
  ON public.record_findings(record_id);
CREATE INDEX IF NOT EXISTS idx_record_findings_person_id 
  ON public.record_findings(person_id);
CREATE INDEX IF NOT EXISTS idx_record_findings_finding_type_id 
  ON public.record_findings(finding_type_id);
CREATE INDEX IF NOT EXISTS idx_record_findings_body_site_id 
  ON public.record_findings(body_site_id);
CREATE INDEX IF NOT EXISTS idx_record_findings_finding_code 
  ON public.record_findings(finding_code);
CREATE INDEX IF NOT EXISTS idx_record_findings_site_code 
  ON public.record_findings(site_code);
CREATE INDEX IF NOT EXISTS idx_record_findings_severity 
  ON public.record_findings(severity);
CREATE INDEX IF NOT EXISTS idx_record_findings_finding_date 
  ON public.record_findings(finding_date);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_record_findings_updated_at
  BEFORE UPDATE ON public.record_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTION: Get findings for a medical record with catalog details
-- ============================================================================
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
  -- Catalog fields
  catalog_finding_name_ru text,
  catalog_finding_name_en text,
  catalog_site_name_ru text,
  catalog_site_name_en text
) AS $$
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- HELPER FUNCTION: Find finding type by code or synonym
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_finding_type_by_text(
  p_text text,
  p_lang text DEFAULT 'ru'
)
RETURNS TABLE (
  id uuid,
  finding_code text
) AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := lower(trim(p_text));
  
  RETURN QUERY
  SELECT ftc.id, ftc.finding_code
  FROM public.finding_type_catalog ftc
  WHERE 
    lower(ftc.finding_code) = v_normalized
    OR (p_lang = 'ru' AND (lower(ftc.name_ru) = v_normalized OR v_normalized = ANY(ftc.synonyms_ru)))
    OR (p_lang = 'en' AND (lower(ftc.name_en) = v_normalized OR v_normalized = ANY(ftc.synonyms_en)))
    OR lower(ftc.name_ru) = v_normalized
    OR lower(ftc.name_en) = v_normalized
    OR v_normalized = ANY(ftc.synonyms_ru)
    OR v_normalized = ANY(ftc.synonyms_en)
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- HELPER FUNCTION: Find body site by code or synonym
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_body_site_by_text(
  p_text text,
  p_lang text DEFAULT 'ru'
)
RETURNS TABLE (
  id uuid,
  site_code text
) AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := lower(trim(p_text));
  
  RETURN QUERY
  SELECT bsc.id, bsc.site_code
  FROM public.body_site_catalog bsc
  WHERE 
    lower(bsc.site_code) = v_normalized
    OR (p_lang = 'ru' AND (lower(bsc.name_ru) = v_normalized OR v_normalized = ANY(bsc.synonyms_ru)))
    OR (p_lang = 'en' AND (lower(bsc.name_en) = v_normalized OR v_normalized = ANY(bsc.synonyms_en)))
    OR lower(bsc.name_ru) = v_normalized
    OR lower(bsc.name_en) = v_normalized
    OR v_normalized = ANY(bsc.synonyms_ru)
    OR v_normalized = ANY(bsc.synonyms_en)
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;
