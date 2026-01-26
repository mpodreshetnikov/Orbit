-- ============================================================================
-- RECORD CHUNKS TABLE (for RAG retrieval in Stage 5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.record_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.medical_records(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  -- embedding vector(1536), -- POST-MVP: uncomment after enabling pgvector extension
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.record_chunks ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allowed users can read chunks for records they can access
CREATE POLICY "Allowed users can read record chunks"
  ON public.record_chunks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Allowed users can insert chunks
CREATE POLICY "Allowed users can insert record chunks"
  ON public.record_chunks FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      JOIN public.allowed_users au ON (
        au.auth_user_id = auth.uid() OR au.email = auth.email()
      )
      WHERE mr.id = record_id
    )
  );

-- RLS Policy: Allowed users can update chunks
CREATE POLICY "Allowed users can update record chunks"
  ON public.record_chunks FOR UPDATE TO authenticated
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

-- RLS Policy: Allowed users can delete chunks
CREATE POLICY "Allowed users can delete record chunks"
  ON public.record_chunks FOR DELETE TO authenticated
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
CREATE INDEX IF NOT EXISTS idx_record_chunks_record_id ON public.record_chunks(record_id);
CREATE INDEX IF NOT EXISTS idx_record_chunks_chunk_index ON public.record_chunks(record_id, chunk_index);

-- ============================================================================
-- FULL-TEXT SEARCH for chunks
-- ============================================================================
-- Create a generated column for full-text search vector on chunks
ALTER TABLE public.record_chunks
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  to_tsvector('russian', coalesce(content, ''))
) STORED;

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_record_chunks_search ON public.record_chunks USING GIN(search_vector);

-- ============================================================================
-- HELPER FUNCTION: Search record chunks for RAG
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_record_chunks(
  search_query text,
  p_person_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  chunk_id uuid,
  record_id uuid,
  chunk_index integer,
  content text,
  record_title text,
  record_date date,
  record_type public.record_type,
  rank real
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rc.id AS chunk_id,
    rc.record_id,
    rc.chunk_index,
    rc.content,
    mr.title AS record_title,
    mr.record_date,
    mr.record_type,
    ts_rank(rc.search_vector, plainto_tsquery('russian', search_query)) AS rank
  FROM public.record_chunks rc
  JOIN public.medical_records mr ON mr.id = rc.record_id
  WHERE
    -- Access control
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
    )
    -- Only active records
    AND mr.status = 'active'
    -- Filter by person if provided
    AND (p_person_id IS NULL OR mr.person_id = p_person_id)
    -- Full-text search
    AND rc.search_vector @@ plainto_tsquery('russian', search_query)
  ORDER BY rank DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
