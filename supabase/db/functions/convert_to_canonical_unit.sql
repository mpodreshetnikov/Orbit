-- Function: convert_to_canonical_unit()
-- Convert observation value to canonical unit

CREATE OR REPLACE FUNCTION public.convert_to_canonical_unit(
  p_obs_code text,
  p_value numeric,
  p_unit text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_accepted_units jsonb;
  v_unit_config jsonb;
  v_factor numeric;
BEGIN
  SELECT accepted_units INTO v_accepted_units
  FROM public.observation_catalog
  WHERE obs_code = p_obs_code;
  
  IF v_accepted_units IS NULL THEN
    RAISE EXCEPTION 'Unknown observation code: %', p_obs_code;
  END IF;
  
  v_unit_config := v_accepted_units -> p_unit;
  
  IF v_unit_config IS NULL THEN
    RAISE EXCEPTION 'Unknown unit "%" for observation "%"', p_unit, p_obs_code;
  END IF;
  
  v_factor := (v_unit_config ->> 'factor_to_canonical')::numeric;
  
  IF v_factor IS NULL THEN
    -- Has formula instead of factor - return NULL to indicate manual conversion needed
    RETURN NULL;
  END IF;
  
  RETURN p_value * v_factor;
END;
$$;

COMMENT ON FUNCTION public.convert_to_canonical_unit(text, numeric, text) IS
  'Convert observation value to canonical unit using accepted_units conversion factors.';
