-- Function: search_medical_records()
-- Full-text search for medical records with prefix matching, ilike fallback, and optional multi-status filter (p_statuses).
DROP FUNCTION IF EXISTS public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer);
DROP FUNCTION IF EXISTS public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer, text[]);

CREATE OR REPLACE FUNCTION public.search_medical_records(
  search_query text DEFAULT NULL,
  p_person_id uuid DEFAULT NULL,
  p_record_type public.record_type DEFAULT NULL,
  p_status public.record_status DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_statuses text[] DEFAULT NULL
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  processed_query text;
  tsquery_val tsquery;
  has_fts_results boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF search_query IS NOT NULL AND search_query != '' THEN
    processed_query := (
      SELECT string_agg(word || ':*', ' & ')
      FROM unnest(string_to_array(trim(search_query), ' ')) AS word
      WHERE word != ''
    );
    BEGIN
      tsquery_val := to_tsquery('english', processed_query);
    EXCEPTION WHEN OTHERS THEN
      tsquery_val := NULL;
    END;
  END IF;

  IF tsquery_val IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.medical_records mr
      WHERE mr.search_vector @@ tsquery_val
        AND (p_person_id IS NULL OR mr.person_id = p_person_id)
        AND (
          (p_statuses IS NOT NULL AND mr.status::text = ANY(p_statuses))
          OR (p_statuses IS NULL AND p_status IS NOT NULL AND mr.status = p_status)
          OR (p_statuses IS NULL AND p_status IS NULL)
        )
        AND public.is_allowed_user()
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
    CASE
      WHEN search_query IS NULL OR search_query = '' THEN 0.0
      WHEN has_fts_results AND tsquery_val IS NOT NULL THEN
        ts_rank_cd(mr.search_vector, tsquery_val, 32) * 
        (1.0 + LEAST(0.5, GREATEST(0.0, (180.0 - (CURRENT_DATE - COALESCE(mr.record_date, mr.created_at::date))::numeric) / 360.0))) *
        CASE mr.record_type WHEN 'lab' THEN 1.1 WHEN 'visit' THEN 1.05 ELSE 1.0 END
      ELSE
        CASE
          WHEN mr.title ILIKE '%' || search_query || '%' THEN 0.8
          WHEN mr.notes ILIKE '%' || search_query || '%' THEN 0.5
          WHEN mr.ocr_text ILIKE '%' || search_query || '%' THEN 0.3
          ELSE 0.0
        END
    END::real AS search_rank
  FROM public.medical_records mr
  LEFT JOIN (
    SELECT record_id, COUNT(*) as cnt FROM public.record_attachments GROUP BY record_id
  ) att ON att.record_id = mr.id
  WHERE
    public.is_allowed_user()
    AND (p_person_id IS NULL OR mr.person_id = p_person_id)
    AND (p_record_type IS NULL OR mr.record_type = p_record_type)
    AND (
      (p_statuses IS NOT NULL AND mr.status::text = ANY(p_statuses))
      OR (p_statuses IS NULL AND p_status IS NOT NULL AND mr.status = p_status)
      OR (p_statuses IS NULL AND p_status IS NULL)
    )
    AND (
      search_query IS NULL OR search_query = ''
      OR (
        (has_fts_results AND tsquery_val IS NOT NULL AND mr.search_vector @@ tsquery_val)
        OR (NOT has_fts_results AND (
          mr.title ILIKE '%' || search_query || '%'
          OR mr.notes ILIKE '%' || search_query || '%'
          OR mr.ocr_text ILIKE '%' || search_query || '%'
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
$$;

REVOKE ALL ON FUNCTION public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer, text[]) TO authenticated;

COMMENT ON FUNCTION public.search_medical_records(text, uuid, public.record_type, public.record_status, integer, integer, text[]) IS
  'Full-text search for medical records. Use p_statuses for multiple statuses, or p_status for a single status, or both null for no status filter.';
