-- Function: money_resolve_fx_rate(date, char(3), char(3))
-- Resolves FX using exact-day or nearest-previous rates, with inverse fallback.

DROP FUNCTION IF EXISTS public.money_resolve_fx_rate(date, char(3), char(3));

CREATE OR REPLACE FUNCTION public.money_resolve_fx_rate(
  p_rate_date date,
  p_source_currency char(3),
  p_target_currency char(3)
)
RETURNS TABLE (
  rate numeric,
  effective_rate_date date,
  is_exact boolean
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_currency char(3) := upper(p_source_currency);
  v_target_currency char(3) := upper(p_target_currency);
BEGIN
  IF p_rate_date IS NULL THEN
    RAISE EXCEPTION 'p_rate_date is required';
  END IF;

  IF v_source_currency IS NULL OR v_target_currency IS NULL THEN
    RAISE EXCEPTION 'Both currencies are required';
  END IF;

  IF v_source_currency = v_target_currency THEN
    rate := 1;
    effective_rate_date := p_rate_date;
    is_exact := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT fx.rate, fx.rate_date, fx.rate_date = p_rate_date
  INTO rate, effective_rate_date, is_exact
  FROM public.money_fx_rates AS fx
  WHERE fx.base_currency = v_source_currency
    AND fx.quote_currency = v_target_currency
    AND fx.rate_date <= p_rate_date
  ORDER BY fx.rate_date DESC
  LIMIT 1;

  IF rate IS NOT NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT 1 / fx.rate, fx.rate_date, fx.rate_date = p_rate_date
  INTO rate, effective_rate_date, is_exact
  FROM public.money_fx_rates AS fx
  WHERE fx.base_currency = v_target_currency
    AND fx.quote_currency = v_source_currency
    AND fx.rate_date <= p_rate_date
  ORDER BY fx.rate_date DESC
  LIMIT 1;

  IF rate IS NOT NULL THEN
    RETURN NEXT;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.money_resolve_fx_rate(date, char(3), char(3)) IS
  'Returns an FX conversion rate for the requested date using exact-day or nearest-previous lookup, with inverse-pair fallback.';
