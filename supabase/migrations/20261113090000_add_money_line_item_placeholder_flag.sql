-- Explicit placeholder flag for synthetic whole-transaction stub line items.
-- Backfills extension stubs (raw_payload.source) and CSV-style single import stubs,
-- then cleans transactions where a stub already coexists with real receipt lines.

ALTER TABLE public.money_line_items
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_money_line_items_placeholder
  ON public.money_line_items(transaction_id)
  WHERE is_placeholder;

-- Extension / DOM fallback stubs.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
WHERE COALESCE(line_item.raw_payload->>'source', '') IN ('fallback', 'dom_fallback');

-- CSV / empty-composition stubs: sole import line matching the transaction amount,
-- not locked by the user.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
WHERE line_item.is_placeholder = false
  AND line_item.assignment_method = 'import'
  AND line_item.import_hash IS NOT NULL
  AND line_item.category_locked_by_user = false
  AND EXISTS (
    SELECT 1
    FROM public.money_transactions AS tx
    WHERE tx.id = line_item.transaction_id
      AND tx.amount = line_item.amount
  )
  AND (
    SELECT count(*)::integer
    FROM public.money_line_items AS sibling
    WHERE sibling.transaction_id = line_item.transaction_id
  ) = 1;

-- Remove stubs that already sit beside real receipt lines (prior apply-batch bug).
-- Only treat non-cancelled siblings as "real": a cancelled receipt line must not
-- trigger stub deletion. Referencing FKs on money_line_items(id) are safe for
-- DELETE — money_category_rule_runs is ON DELETE CASCADE, import batch rows and
-- related_line_item_id are ON DELETE SET NULL (no RESTRICT/NO ACTION).
DELETE FROM public.money_line_items AS placeholder
WHERE placeholder.is_placeholder
  AND NOT placeholder.category_locked_by_user
  AND placeholder.assignment_method = 'import'
  AND EXISTS (
    SELECT 1
    FROM public.money_line_items AS other
    WHERE other.transaction_id = placeholder.transaction_id
      AND other.id <> placeholder.id
      AND NOT other.is_placeholder
      AND other.line_status <> 'cancelled'
  );
