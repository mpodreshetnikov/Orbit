-- Create enum type for record types
CREATE TYPE public.record_type AS ENUM (
  'lab',
  'visit',
  'imaging',
  'prescription',
  'vaccination',
  'vet',
  'other'
);

-- Create enum type for record status
CREATE TYPE public.record_status AS ENUM (
  'draft',
  'active',
  'removed'
);

-- ============================================================================
-- MEDICAL RECORDS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.medical_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  record_type public.record_type NOT NULL DEFAULT 'other',
  record_date date,
  title text NOT NULL,
  notes text,
  status public.record_status NOT NULL DEFAULT 'draft',
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Extraction fields (populated by LLM in Stage 4)
  ocr_text text,
  llm_summary text,
  llm_keywords text[]
);

-- Enable RLS
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allowed users can read all medical records
CREATE POLICY "Allowed users can read medical records"
  ON public.medical_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- RLS Policy: Allowed users can insert medical records
CREATE POLICY "Allowed users can insert medical records"
  ON public.medical_records FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
    AND created_by_user_id = auth.uid()
  );

-- RLS Policy: Allowed users can update medical records
CREATE POLICY "Allowed users can update medical records"
  ON public.medical_records FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- RLS Policy: Allowed users can delete medical records (hard delete if needed)
CREATE POLICY "Allowed users can delete medical records"
  ON public.medical_records FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_medical_records_person_id ON public.medical_records(person_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_status ON public.medical_records(status);
CREATE INDEX IF NOT EXISTS idx_medical_records_record_type ON public.medical_records(record_type);
CREATE INDEX IF NOT EXISTS idx_medical_records_record_date ON public.medical_records(record_date);
CREATE INDEX IF NOT EXISTS idx_medical_records_created_by ON public.medical_records(created_by_user_id);

-- Trigger to auto-update updated_at on medical_records table
CREATE TRIGGER update_medical_records_updated_at
  BEFORE UPDATE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- FULL-TEXT SEARCH
-- ============================================================================
-- Create a generated column for full-text search vector
ALTER TABLE public.medical_records
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(notes, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(ocr_text, '')), 'C')
) STORED;

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_medical_records_search ON public.medical_records USING GIN(search_vector);

-- ============================================================================
-- RECORD ATTACHMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.record_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.medical_records(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  original_filename text NOT NULL,
  file_size bigint,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.record_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allowed users can read attachments for records they can access
CREATE POLICY "Allowed users can read record attachments"
  ON public.record_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Allowed users can insert attachments
CREATE POLICY "Allowed users can insert record attachments"
  ON public.record_attachments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Allowed users can update attachments
CREATE POLICY "Allowed users can update record attachments"
  ON public.record_attachments FOR UPDATE TO authenticated
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

-- RLS Policy: Allowed users can delete attachments
CREATE POLICY "Allowed users can delete record attachments"
  ON public.record_attachments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_record_attachments_record_id ON public.record_attachments(record_id);
CREATE INDEX IF NOT EXISTS idx_record_attachments_sort_order ON public.record_attachments(record_id, sort_order);

-- ============================================================================
-- HELPER FUNCTION: Search medical records
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_medical_records(
  search_query text,
  p_person_id uuid DEFAULT NULL,
  p_record_type public.record_type DEFAULT NULL,
  p_status public.record_status DEFAULT 'active',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  person_id uuid,
  record_type public.record_type,
  record_date date,
  title text,
  notes text,
  status public.record_status,
  created_at timestamptz,
  updated_at timestamptz,
  attachment_count bigint,
  rank real
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    mr.id,
    mr.person_id,
    mr.record_type,
    mr.record_date,
    mr.title,
    mr.notes,
    mr.status,
    mr.created_at,
    mr.updated_at,
    COUNT(ra.id) AS attachment_count,
    CASE 
      WHEN search_query IS NOT NULL AND search_query != '' 
      THEN ts_rank(mr.search_vector, websearch_to_tsquery('english', search_query))
      ELSE 1.0
    END AS rank
  FROM public.medical_records mr
  LEFT JOIN public.record_attachments ra ON ra.record_id = mr.id
  WHERE
    -- Access control
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
    )
    -- Filters
    AND (p_person_id IS NULL OR mr.person_id = p_person_id)
    AND (p_record_type IS NULL OR mr.record_type = p_record_type)
    AND (p_status IS NULL OR mr.status = p_status)
    -- Full-text search
    AND (
      search_query IS NULL 
      OR search_query = '' 
      OR mr.search_vector @@ websearch_to_tsquery('english', search_query)
    )
  GROUP BY mr.id
  ORDER BY
    CASE 
      WHEN search_query IS NOT NULL AND search_query != '' 
      THEN ts_rank(mr.search_vector, websearch_to_tsquery('english', search_query))
      ELSE 0
    END DESC,
    mr.record_date DESC NULLS LAST,
    mr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
