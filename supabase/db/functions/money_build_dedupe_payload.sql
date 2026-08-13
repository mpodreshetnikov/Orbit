-- Function: money_build_dedupe_payload(text, timestamptz, numeric, text, text, text, integer)
-- The canonical text a money import row is hashed from.
--
-- This is the SQL twin of `buildMoneyDedupePayload` in `shared/lib/money/dedupe.ts`. The two must
-- agree character for character: the migration that recomputes stored hashes uses this function,
-- and re-importing the same statement afterwards recomputes them in TypeScript. A single character
-- of drift means every row of that statement is imported a second time.
--
-- Canonicalisation, matching the TypeScript side exactly:
--   * the instant is always rendered in UTC with milliseconds, so a local-offset input and a UTC
--     input agree;
--   * the amount always carries two decimals, so 120.5 and 120.50 are one value;
--   * text fields are trimmed, the currency is upper-cased;
--   * the occurrence distinguishes rows that agree on everything else.

CREATE OR REPLACE FUNCTION public.money_build_dedupe_payload(
  p_source text,
  p_posted_at timestamptz,
  p_amount numeric,
  p_currency text,
  p_merchant_name text,
  p_account_hint text,
  p_occurrence integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT concat_ws(
    '|',
    btrim(COALESCE(p_source, '')),
    -- concat_ws drops NULL arguments, which would silently shift every field after it, so every
    -- part is made non-NULL before it gets here.
    COALESCE(to_char(p_posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
    to_char(round(COALESCE(p_amount, 0), 2), 'FM9999999999999990.00'),
    upper(btrim(COALESCE(p_currency, ''))),
    btrim(COALESCE(p_merchant_name, '')),
    btrim(COALESCE(p_account_hint, '')),
    GREATEST(COALESCE(p_occurrence, 0), 0)::text
  );
$$;

COMMENT ON FUNCTION public.money_build_dedupe_payload(text, timestamptz, numeric, text, text, text, integer) IS
  'Canonical text a money import row is hashed from. SQL twin of buildMoneyDedupePayload in shared/lib/money/dedupe.ts; the two must stay byte-identical.';
