-- Function: money_normalize_transfer_text(text)
-- Deterministically normalizes transfer counterparty text for self-transfer matching.

CREATE OR REPLACE FUNCTION public.money_normalize_transfer_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(
    regexp_replace(
      replace(lower(btrim(p_text)), 'ё', 'е'),
      '[^a-z0-9а-я]+',
      '',
      'g'
    ),
    ''
  );
$$;

COMMENT ON FUNCTION public.money_normalize_transfer_text(text) IS
  'Normalizes transfer counterparty text by lowercasing, replacing ё with е, and stripping punctuation and spaces.';
