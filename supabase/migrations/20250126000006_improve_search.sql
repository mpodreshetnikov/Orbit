-- ============================================================================
-- IMPROVED FULL-TEXT SEARCH FUNCTION
-- ============================================================================
-- This replaces the previous search function with better support for:
-- 1. Prefix matching (partial words with :*)
-- 2. Fallback to ilike when FTS returns no results
-- 3. Ranking with metadata boosts (recent records, certain types)

-- Drop the old function first
DROP FUNCTION IF EXISTS public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer);

-- Create improved search function
CREATE OR REPLACE FUNCTION public.search_medical_records(
  search_query text DEFAULT NULL,
  p_person_id uuid DEFAULT NULL,
  p_record_type public.record_type DEFAULT NULL,
  p_status public.record_status DEFAULT 'active',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  person_id uuid,
  created_by_user_id uuid,
  record_type public.record_type,
  record_date date,
  title text,
  notes text,
  status public.record_status,
  removed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  ocr_text text,
  llm_summary text,
  llm_keywords text[],
  attachment_count bigint,
  search_rank real
) AS $$
DECLARE
  processed_query text;
  tsquery_val tsquery;
  has_fts_results boolean := false;
BEGIN
  -- Process search query for prefix matching
  -- Convert "blood test" to "blood:* & test:*" for prefix matching
  IF search_query IS NOT NULL AND search_query != '' THEN
    -- Split words and add :* for prefix matching, join with &
    processed_query := (
      SELECT string_agg(word || ':*', ' & ')
      FROM unnest(string_to_array(trim(search_query), ' ')) AS word
      WHERE word != ''
    );
    
    -- Create tsquery, handle potential errors
    BEGIN
      tsquery_val := to_tsquery('english', processed_query);
    EXCEPTION WHEN OTHERS THEN
      -- If tsquery fails, set to NULL and we'll use ilike fallback
      tsquery_val := NULL;
    END;
  END IF;

  -- First, try full-text search if we have a valid query
  IF tsquery_val IS NOT NULL THEN
    -- Check if FTS returns any results
    SELECT EXISTS(
      SELECT 1 FROM public.medical_records mr
      WHERE mr.search_vector @@ tsquery_val
        AND (p_person_id IS NULL OR mr.person_id = p_person_id)
        AND (p_status IS NULL OR mr.status = p_status)
        AND EXISTS (
          SELECT 1 FROM public.allowed_users au
          WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
        )
      LIMIT 1
    ) INTO has_fts_results;
  END IF;

  -- Return results based on search strategy
  RETURN QUERY
  SELECT
    mr.id,
    mr.person_id,
    mr.created_by_user_id,
    mr.record_type,
    mr.record_date,
    mr.title,
    mr.notes,
    mr.status,
    mr.removed_at,
    mr.created_at,
    mr.updated_at,
    mr.ocr_text,
    mr.llm_summary,
    mr.llm_keywords,
    COALESCE(att.cnt, 0)::bigint AS attachment_count,
    -- Calculate search rank with metadata boosts
    CASE
      WHEN search_query IS NULL OR search_query = '' THEN 0.0
      WHEN has_fts_results AND tsquery_val IS NOT NULL THEN
        -- FTS rank with boosts
        ts_rank_cd(mr.search_vector, tsquery_val, 32) * 
        -- Boost recent records (within last 6 months get up to 1.5x boost)
        -- Note: CURRENT_DATE - date returns integer days directly in PostgreSQL
        (1.0 + LEAST(0.5, GREATEST(0.0, (180.0 - (CURRENT_DATE - COALESCE(mr.record_date, mr.created_at::date))::numeric) / 360.0))) *
        -- Boost certain types (lab results and visits slightly higher)
        CASE mr.record_type 
          WHEN 'lab' THEN 1.1 
          WHEN 'visit' THEN 1.05 
          ELSE 1.0 
        END
      ELSE
        -- Fallback: ilike match score (simple matching)
        CASE
          WHEN mr.title ILIKE '%' || search_query || '%' THEN 0.8
          WHEN mr.notes ILIKE '%' || search_query || '%' THEN 0.5
          WHEN mr.ocr_text ILIKE '%' || search_query || '%' THEN 0.3
          ELSE 0.0
        END
    END::real AS search_rank
  FROM public.medical_records mr
  LEFT JOIN (
    SELECT record_id, COUNT(*) as cnt 
    FROM public.record_attachments 
    GROUP BY record_id
  ) att ON att.record_id = mr.id
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
    -- Search condition
    AND (
      search_query IS NULL 
      OR search_query = '' 
      OR (
        -- Use FTS if it has results
        (has_fts_results AND tsquery_val IS NOT NULL AND mr.search_vector @@ tsquery_val)
        -- Otherwise fallback to ilike
        OR (NOT has_fts_results AND (
          mr.title ILIKE '%' || search_query || '%'
          OR mr.notes ILIKE '%' || search_query || '%'
          OR mr.ocr_text ILIKE '%' || search_query || '%'
        ))
      )
    )
  ORDER BY
    -- First by search rank if searching
    CASE WHEN search_query IS NOT NULL AND search_query != '' THEN search_rank ELSE 0 END DESC,
    -- Then by date
    mr.record_date DESC NULLS LAST,
    mr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.search_medical_records TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON FUNCTION public.search_medical_records IS 
'Full-text search for medical records with:
- Prefix matching (partial words)
- Fallback to ilike when FTS returns no results
- Ranking with metadata boosts (recency, record type)
- Supports both UI search and RAG retrieval';
