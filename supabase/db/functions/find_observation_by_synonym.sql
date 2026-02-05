-- Function: find_observation_by_synonym()
-- Find observation catalog entry by synonym text

CREATE OR REPLACE FUNCTION public.find_observation_by_synonym(
  p_text text,
  p_lang text DEFAULT 'en'
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_normalized text;
  v_result text;
BEGIN
  v_normalized := lower(trim(p_text));
  
  IF p_lang = 'ru' THEN
    SELECT obs_code INTO v_result
    FROM public.observation_catalog
    WHERE v_normalized = ANY(synonyms_ru)
       OR lower(name_ru) = v_normalized
    LIMIT 1;
  ELSE
    SELECT obs_code INTO v_result
    FROM public.observation_catalog
    WHERE v_normalized = ANY(synonyms_en)
       OR lower(name_en) = v_normalized
    LIMIT 1;
  END IF;
  
  -- If not found in specified language, try the other
  IF v_result IS NULL THEN
    IF p_lang = 'ru' THEN
      SELECT obs_code INTO v_result
      FROM public.observation_catalog
      WHERE v_normalized = ANY(synonyms_en)
         OR lower(name_en) = v_normalized
      LIMIT 1;
    ELSE
      SELECT obs_code INTO v_result
      FROM public.observation_catalog
      WHERE v_normalized = ANY(synonyms_ru)
         OR lower(name_ru) = v_normalized
      LIMIT 1;
    END IF;
  END IF;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.find_observation_by_synonym(text, text) IS
  'Find observation catalog obs_code by synonym or name (case-insensitive). Tries specified lang first, then falls back.';
