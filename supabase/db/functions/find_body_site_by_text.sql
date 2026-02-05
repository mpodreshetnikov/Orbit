-- Function: find_body_site_by_text()
-- Find body site by code or synonym

CREATE OR REPLACE FUNCTION public.find_body_site_by_text(
  p_text text,
  p_lang text DEFAULT 'ru'
)
RETURNS TABLE (
  id uuid,
  site_code text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.find_body_site_by_text(text, text) IS
  'Find body site catalog entry by code, name, or synonym. Returns id and site_code.';
