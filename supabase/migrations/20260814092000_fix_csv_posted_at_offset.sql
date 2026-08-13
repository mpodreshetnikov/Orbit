-- Correct the timestamp of transactions imported from a T-Bank CSV statement, and recompute their
-- dedupe hash with the canonical formula.
--
-- The statement prints Moscow local time. The connector appended "Z" to it, declaring local time to
-- be UTC, so every operation moved three hours back and anything after 21:00 landed in the previous
-- calendar day. The budget report cuts months in UTC, so those operations were reported in the wrong
-- month. Moscow has been a fixed UTC+03:00 with no daylight saving since 2014, which is why a single
-- constant offset is a correction and not an approximation.
--
-- Only statement rows are touched. A CSV row keeps the raw statement record in `raw_payload`, which
-- always carries the "Дата операции" column; no row from the extension has that key. `jsonb_exists`
-- is used rather than the `?` operator because `?` collides with parameter placeholders.

-- Recomputing hashes needs digest(); the extension is standard in Supabase.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Migrations run before the idempotent SQL under supabase/db is deployed, so on a fresh database
-- this function does not exist yet. It is defined here as well, identically, and the deploy step
-- re-creates it from supabase/db/functions/money_build_dedupe_payload.sql, which stays canonical.
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
    COALESCE(to_char(p_posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
    to_char(round(COALESCE(p_amount, 0), 2), 'FM9999999999999990.00'),
    upper(btrim(COALESCE(p_currency, ''))),
    btrim(COALESCE(p_merchant_name, '')),
    btrim(COALESCE(p_account_hint, '')),
    GREATEST(COALESCE(p_occurrence, 0), 0)::text
  );
$$;

-- Applying this twice would shift the same rows again, so treated rows are stamped and excluded.
UPDATE public.money_transactions
SET
  posted_at = posted_at - interval '3 hours',
  raw_payload = raw_payload || jsonb_build_object('posted_at_offset_fixed', true)
WHERE raw_payload IS NOT NULL
  AND jsonb_exists(raw_payload, 'Дата операции')
  AND NOT COALESCE((raw_payload->>'posted_at_offset_fixed')::boolean, false);

-- The identity of a statement row is its hash: it has no external_id. The formula changed (one
-- SHA-256 over a canonical payload, shared by the app and the extension, with an occurrence number
-- so two identical purchases on the same day stay two rows), so stored hashes must be recomputed —
-- otherwise re-uploading the same statement would import every row a second time.
--
-- public.money_build_dedupe_payload is the SQL twin of buildMoneyDedupePayload in
-- shared/lib/money/dedupe.ts. The two are asserted equal, field for field, in
-- supabase/tests/functions/money_dedupe_payload_test.sql and shared/lib/money/dedupe.test.ts.
WITH statement_rows AS (
  SELECT
    transaction.id,
    transaction.source,
    transaction.posted_at,
    transaction.amount,
    transaction.currency,
    transaction.merchant_name,
    -- Same rule as extractAccountHint in the connector: drop the masking stars, trim, keep the last
    -- four digits when there are at least four.
    (
      CASE
        WHEN length(btrim(replace(COALESCE(transaction.raw_payload->>'Номер карты', ''), '*', ''))) >= 4
          THEN right(btrim(replace(COALESCE(transaction.raw_payload->>'Номер карты', ''), '*', '')), 4)
        ELSE btrim(replace(COALESCE(transaction.raw_payload->>'Номер карты', ''), '*', ''))
      END
    ) AS account_hint,
    transaction.created_at
  FROM public.money_transactions AS transaction
  WHERE transaction.raw_payload IS NOT NULL
    AND jsonb_exists(transaction.raw_payload, 'Дата операции')
),
numbered AS (
  SELECT
    statement_rows.*,
    -- The occurrence must match what the connector assigns on re-upload. The bank returns a
    -- statement in a stable order and rows were inserted in that order, so ordering by insertion
    -- reproduces it. Only groups that agree on every hashed field are affected at all.
    (row_number() OVER (
      PARTITION BY
        statement_rows.source,
        statement_rows.posted_at,
        statement_rows.amount,
        statement_rows.currency,
        COALESCE(statement_rows.merchant_name, ''),
        statement_rows.account_hint
      ORDER BY statement_rows.created_at, statement_rows.id
    ) - 1)::integer AS occurrence
  FROM statement_rows
)
UPDATE public.money_transactions AS transaction
SET dedupe_hash = encode(
  digest(
    public.money_build_dedupe_payload(
      numbered.source,
      numbered.posted_at,
      numbered.amount,
      numbered.currency,
      numbered.merchant_name,
      numbered.account_hint,
      numbered.occurrence
    ),
    'sha256'
  ),
  'hex'
)
FROM numbered
WHERE numbered.id = transaction.id;
