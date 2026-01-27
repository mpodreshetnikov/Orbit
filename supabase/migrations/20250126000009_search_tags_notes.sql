
-- ============================================================================
-- ENHANCED SEARCH: Add tags (llm_keywords) and notes search with smaller boost
-- ============================================================================

-- ============================================================================
-- 1. UPDATE UI SEARCH FUNCTION
-- Add search in llm_keywords array and improve notes matching
-- ============================================================================
DROP FUNCTION IF EXISTS public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer);

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
  search_words text[];
BEGIN
  -- Process search query for prefix matching
  IF search_query IS NOT NULL AND search_query != '' THEN
    -- Store search words for keyword matching
    search_words := string_to_array(lower(trim(search_query)), ' ');
    
    -- Split words and add :* for prefix matching, join with &
    processed_query := (
      SELECT string_agg(word || ':*', ' & ')
      FROM unnest(string_to_array(trim(search_query), ' ')) AS word
      WHERE word != ''
    );
    
    -- Create tsquery, handle potential errors
    -- Try russian first (primary language), then simple as fallback
    BEGIN
      tsquery_val := to_tsquery('russian', processed_query);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        tsquery_val := to_tsquery('simple', processed_query);
      EXCEPTION WHEN OTHERS THEN
        tsquery_val := NULL;
      END;
    END;
  END IF;

  -- First, try full-text search if we have a valid query
  IF tsquery_val IS NOT NULL THEN
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
        (
          ts_rank_cd(mr.search_vector, tsquery_val, 32) +
          -- Add bonus for keyword/tag matches (0.15 per matching keyword)
          -- Uses fuzzy matching for Russian morphology
          COALESCE((
            SELECT COUNT(*)::real * 0.15
            FROM unnest(mr.llm_keywords) AS kw
            WHERE EXISTS (
              SELECT 1 FROM unnest(search_words) AS sw
              WHERE 
                lower(kw) LIKE '%' || sw || '%'
                OR sw LIKE '%' || lower(kw) || '%'
                OR (length(sw) >= 4 AND length(kw) >= 4 AND (
                  lower(kw) LIKE left(sw, 4) || '%' 
                  OR sw LIKE left(lower(kw), 4) || '%'
                ))
            )
          ), 0.0) +
          -- Add small bonus for notes match (0.1)
          CASE WHEN mr.notes IS NOT NULL AND mr.notes ILIKE '%' || search_query || '%' THEN 0.1 ELSE 0.0 END
        ) *
        -- Boost recent records
        (1.0 + LEAST(0.5, GREATEST(0.0, (180.0 - (CURRENT_DATE - COALESCE(mr.record_date, mr.created_at::date))::numeric) / 360.0))) *
        -- Boost certain types
        CASE mr.record_type 
          WHEN 'lab' THEN 1.1 
          WHEN 'visit' THEN 1.05 
          ELSE 1.0 
        END
      ELSE
        -- Fallback: ilike match score with keyword bonus
        CASE
          WHEN mr.title ILIKE '%' || search_query || '%' THEN 0.8
          WHEN mr.notes ILIKE '%' || search_query || '%' THEN 0.5
          WHEN mr.ocr_text ILIKE '%' || search_query || '%' THEN 0.3
          -- Check keywords with lower priority (fuzzy matching for Russian morphology)
          WHEN mr.llm_keywords IS NOT NULL AND EXISTS (
            SELECT 1 FROM unnest(mr.llm_keywords) AS kw
            WHERE EXISTS (
              SELECT 1 FROM unnest(search_words) AS sw
              WHERE 
                lower(kw) LIKE '%' || sw || '%'
                OR sw LIKE '%' || lower(kw) || '%'
                OR (length(sw) >= 4 AND length(kw) >= 4 AND (
                  lower(kw) LIKE left(sw, 4) || '%' 
                  OR sw LIKE left(lower(kw), 4) || '%'
                ))
            )
          ) THEN 0.4
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
    -- Search condition (expanded to include keywords)
    AND (
      search_query IS NULL 
      OR search_query = '' 
      OR (
        (has_fts_results AND tsquery_val IS NOT NULL AND mr.search_vector @@ tsquery_val)
        OR (NOT has_fts_results AND (
          mr.title ILIKE '%' || search_query || '%'
          OR mr.notes ILIKE '%' || search_query || '%'
          OR mr.ocr_text ILIKE '%' || search_query || '%'
          -- Also search in keywords/tags (fuzzy matching for Russian morphology)
          OR (mr.llm_keywords IS NOT NULL AND search_words IS NOT NULL AND EXISTS (
            SELECT 1 FROM unnest(mr.llm_keywords) AS kw
            WHERE EXISTS (
              SELECT 1 FROM unnest(search_words) AS sw
              WHERE 
                lower(kw) LIKE '%' || sw || '%'
                OR sw LIKE '%' || lower(kw) || '%'
                OR (length(sw) >= 4 AND length(kw) >= 4 AND (
                  lower(kw) LIKE left(sw, 4) || '%' 
                  OR sw LIKE left(lower(kw), 4) || '%'
                ))
            )
          ))
        ))
      )
    )
  ORDER BY
    CASE WHEN search_query IS NOT NULL AND search_query != '' THEN search_rank ELSE 0 END DESC,
    mr.record_date DESC NULLS LAST,
    mr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.search_medical_records TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON FUNCTION public.search_medical_records IS 
'Full-text search for medical records with:
- Prefix matching (partial words)
- Fallback to ilike when FTS returns no results
- Searches in title, notes, OCR text, and keywords/tags
- Keywords/tags get smaller ranking bonus (0.15 per match)
- Notes matches get 0.1 bonus
- Ranking with metadata boosts (recency, record type)';
