-- Explicit placeholder flag for synthetic whole-transaction stub line items.
-- Backfills only rows with synthetic provenance markers (extension/DOM sources or
-- historical T-Bank CSV column keys). Does not mark genuine single-item receipts.

ALTER TABLE public.money_line_items
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_money_line_items_placeholder
  ON public.money_line_items(transaction_id)
  WHERE is_placeholder;

-- Extension / DOM fallback stubs.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
WHERE COALESCE(line_item.raw_payload->>'source', '') IN ('fallback', 'dom_fallback');

-- Historical T-Bank CSV stubs: sole unlocked import line matching txn amount, with
-- CSV column keys in raw_payload (not a receipt composition).
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
WHERE line_item.is_placeholder = false
  AND line_item.assignment_method = 'import'
  AND line_item.category_locked_by_user = false
  AND (
    line_item.raw_payload ? 'Дата операции'
    OR line_item.raw_payload ? 'Описание'
  )
  AND EXISTS (
    SELECT 1
    FROM public.money_transactions AS tx
    WHERE tx.id = line_item.transaction_id
      AND tx.amount = line_item.amount
      AND tx.source = 'tbank'
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
