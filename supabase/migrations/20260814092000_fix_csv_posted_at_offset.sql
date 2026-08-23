-- Money transactions: correct statement timestamps and recompute their identity hash.
--
-- The CSV parser read Moscow wall-clock time as if it were UTC, so every statement row sits
-- three hours earlier than it happened. In reports that moves late-evening purchases into
-- the previous calendar day, and it puts a statement row three hours away from the same
-- operation seen through the bank's API — which is one of the reasons the two never matched.
--
-- Only statement rows are touched. They are the only ones whose raw payload carries the
-- statement's own column name; nothing coming from the extension has it. `jsonb_exists` is
-- the function form of the `?` operator, which would otherwise collide with parameter
-- placeholders.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Re-running this migration must not shift the same row twice, so an applied row is marked
-- and excluded. The hash recompute below is idempotent by construction: it derives the
-- value from fields it does not change.
UPDATE public.money_transactions AS transaction
SET
  posted_at = transaction.posted_at - interval '3 hours',
  raw_payload = transaction.raw_payload || jsonb_build_object('posted_at_offset_fixed', true)
WHERE jsonb_exists(transaction.raw_payload, 'Дата операции')
  AND COALESCE((transaction.raw_payload->>'posted_at_offset_fixed')::boolean, false) = false;

-- Recompute dedupe_hash for statement rows with the shared formula.
--
-- The text assembled here must match shared/lib/money/dedupe.ts character for character —
-- same field order, same separator, same normalisation — or re-importing the same statement
-- creates duplicates instead of recognising what is already there.
--
--   source | posted_at (UTC ISO-8601 with milliseconds) | amount (2 decimals)
--          | currency | merchant_name | account_hint | occurrence
--
-- Text fields are lowercased with runs of whitespace collapsed; currency is upper-cased;
-- a missing merchant or account hint is the empty string.
WITH statement_transactions AS (
  SELECT
    transaction.id,
    lower(btrim(regexp_replace(COALESCE(transaction.source, ''), '\s+', ' ', 'g'))) AS source_text,
    to_char(transaction.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS posted_at_text,
    to_char(round(transaction.amount, 2), 'FM999999999999990.00') AS amount_text,
    upper(lower(btrim(regexp_replace(COALESCE(transaction.currency, ''), '\s+', ' ', 'g')))) AS currency_text,
    lower(btrim(regexp_replace(COALESCE(transaction.merchant_name, ''), '\s+', ' ', 'g'))) AS merchant_text,
    -- money_transactions has no account_hint column: the importer consumes the hint to
    -- resolve the account and card, then discards it. For a statement row the original
    -- value survives in raw_payload under the statement's own card column, and the parser
    -- derives the hint by stripping the mask characters — reproduced here.
    lower(btrim(regexp_replace(
      btrim(replace(btrim(COALESCE(transaction.raw_payload->>'Номер карты', '')), '*', '')),
      '\s+', ' ', 'g'
    ))) AS account_hint_text
  FROM public.money_transactions AS transaction
  WHERE jsonb_exists(transaction.raw_payload, 'Дата операции')
),
numbered AS (
  SELECT
    statement_transactions.*,
    -- Repeats of an otherwise identical purchase are numbered in a stable order so the two
    -- rows keep distinct identities instead of collapsing into one.
    (
      row_number() OVER (
        PARTITION BY
          source_text,
          posted_at_text,
          amount_text,
          currency_text,
          merchant_text,
          account_hint_text
        ORDER BY id
      ) - 1
    ) AS occurrence
  FROM statement_transactions
)
UPDATE public.money_transactions AS transaction
SET dedupe_hash = encode(
  digest(
    concat_ws(
      '|',
      numbered.source_text,
      numbered.posted_at_text,
      numbered.amount_text,
      numbered.currency_text,
      numbered.merchant_text,
      numbered.account_hint_text,
      numbered.occurrence::text
    ),
    'sha256'
  ),
  'hex'
)
FROM numbered
WHERE numbered.id = transaction.id;
