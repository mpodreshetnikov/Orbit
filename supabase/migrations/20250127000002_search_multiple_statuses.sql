-- ============================================================================
-- Update search_medical_records to support multiple statuses
-- This is needed for the new OCR workflow where:
-- - "Processing" tab shows: ocr_processing, structuring, processing
-- - "Drafts" tab shows: draft, ocr_review, structure_review
-- ============================================================================

DROP FUNCTION IF EXISTS public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer);

CREATE OR REPLACE FUNCTION public.search_medical_records(
  search_query text DEFAULT NULL,
  p_person_id uuid DEFAULT NULL,
  p_record_type public.record_type DEFAULT NULL,
  p_status public.record_status DEFAULT NULL,  -- Single status (backward compatible)
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_statuses text[] DEFAULT NULL  -- NEW: Array of status strings for multi-status filtering
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
        AND (
          -- Multi-status filter (if provided)
          (p_statuses IS NOT NULL AND mr.status::text = ANY(p_statuses))
          -- Single status filter (backward compatible)
          OR (p_statuses IS NULL AND p_status IS NOT NULL AND mr.status = p_status)
          -- No status filter
          OR (p_statuses IS NULL AND p_status IS NULL)
        )
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
        (
          ts_rank_cd(mr.search_vector, tsquery_val, 32) +
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
          CASE WHEN mr.notes IS NOT NULL AND mr.notes ILIKE '%' || search_query || '%' THEN 0.1 ELSE 0.0 END
        ) *
        (1.0 + LEAST(0.5, GREATEST(0.0, (180.0 - (CURRENT_DATE - COALESCE(mr.record_date, mr.created_at::date))::numeric) / 360.0))) *
        CASE mr.record_type 
          WHEN 'lab' THEN 1.1 
          WHEN 'visit' THEN 1.05 
          ELSE 1.0 
        END
      ELSE
        CASE
          WHEN mr.title ILIKE '%' || search_query || '%' THEN 0.8
          WHEN mr.notes ILIKE '%' || search_query || '%' THEN 0.5
          WHEN mr.ocr_text ILIKE '%' || search_query || '%' THEN 0.3
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
          ) THEN 0.2
          ELSE 0.0
        END
    END::real AS search_rank
  FROM public.medical_records mr
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.record_attachments ra
    WHERE ra.record_id = mr.id
  ) att ON true
  WHERE
    -- Access control
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
    )
    -- Person filter
    AND (p_person_id IS NULL OR mr.person_id = p_person_id)
    -- Record type filter
    AND (p_record_type IS NULL OR mr.record_type = p_record_type)
    -- Status filter: multi-status OR single status OR no filter
    AND (
      (p_statuses IS NOT NULL AND mr.status::text = ANY(p_statuses))
      OR (p_statuses IS NULL AND p_status IS NOT NULL AND mr.status = p_status)
      OR (p_statuses IS NULL AND p_status IS NULL)
    )
    -- Full-text search OR ilike fallback
    AND (
      search_query IS NULL 
      OR search_query = ''
      OR (has_fts_results AND tsquery_val IS NOT NULL AND mr.search_vector @@ tsquery_val)
      OR (NOT has_fts_results AND (
        mr.title ILIKE '%' || search_query || '%'
        OR mr.notes ILIKE '%' || search_query || '%'
        OR mr.ocr_text ILIKE '%' || search_query || '%'
        OR (mr.llm_keywords IS NOT NULL AND EXISTS (
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
  ORDER BY
    -- Primary: search rank for search queries
    CASE 
      WHEN search_query IS NOT NULL AND search_query != '' THEN 1 
      ELSE 0 
    END DESC,
    search_rank DESC,
    -- Secondary: date (recent first)
    mr.record_date DESC NULLS LAST,
    mr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.search_medical_records TO authenticated;

COMMENT ON FUNCTION public.search_medical_records IS 
'Search medical records with FTS, multi-status support, and ranking boosts. Use p_statuses array for filtering multiple statuses at once.';
