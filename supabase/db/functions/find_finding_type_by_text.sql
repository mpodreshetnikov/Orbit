-- Function: find_finding_type_by_text()
-- Find finding type by code or synonym

CREATE OR REPLACE FUNCTION public.find_finding_type_by_text(
  p_text text,
  p_lang text DEFAULT 'ru'
)
RETURNS TABLE (
  id uuid,
  finding_code text
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
$$;

COMMENT ON FUNCTION public.find_finding_type_by_text(text, text) IS
  'Find finding type catalog entry by code, name, or synonym. Returns id and finding_code.';
