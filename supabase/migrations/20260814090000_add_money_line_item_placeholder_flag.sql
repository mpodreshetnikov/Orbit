-- Money line items: mark placeholder compositions explicitly.
--
-- When a receipt cannot be fetched, import still writes a single line item covering the
-- whole operation so the transaction is not left empty. Until now that placeholder was
-- recognised only by a `source` marker the extension writes into `raw_payload`, which the
-- CSV importer never produces. An explicit column makes the distinction independent of
-- whichever connector produced the row.

ALTER TABLE public.money_line_items
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_money_line_items_placeholder
  ON public.money_line_items(transaction_id)
  WHERE is_placeholder;

COMMENT ON COLUMN public.money_line_items.is_placeholder IS
  'True when the line item only stands in for a receipt that could not be fetched; such rows are replaced by a real composition on the next enrichment pass.';

-- Backfill 1: placeholders the extension marked in raw_payload.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
WHERE NOT line_item.is_placeholder
  AND lower(line_item.raw_payload->>'source') IN ('fallback', 'dom_fallback');

-- Backfill 2: placeholders the CSV importer produced. They carry no marker at all, so they
-- are recognised by shape — an imported line item covering the transaction's full amount,
-- untouched by a human.
--
-- Two shapes qualify, and the second is the one that matters most:
--
--   * the transaction's only line item — an ordinary statement row nothing has enriched yet;
--   * a line item whose siblings already add up to the whole transaction on their own — the
--     corrupted shape, where a real receipt landed beside the placeholder instead of
--     replacing it and the spending counts twice.
--
-- Requiring the placeholder to be alone would exclude the corrupted shape by definition,
-- which is precisely the shape this migration exists to repair. A CSV placeholder carries no
-- `fallback` marker either, so backfill 1 does not reach it, and the cleanup below only
-- deletes rows already flagged — leaving those transactions double-counted forever.
--
-- Restricting the second shape to "siblings already explain the whole amount" is what keeps
-- it safe: flagging the row is only proposed when removing it makes the sums correct.
--
-- Either shape can also match a genuine single-item receipt. That is harmless: the next
-- enrichment pass deletes it and re-inserts identical content, because `import_hash` is
-- derived from the content itself. Nothing is lost and no duplicate appears.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
FROM public.money_transactions AS transaction
WHERE transaction.id = line_item.transaction_id
  AND NOT line_item.is_placeholder
  AND line_item.assignment_method = 'import'
  AND line_item.import_hash IS NOT NULL
  AND NOT line_item.category_locked_by_user
  AND round(line_item.amount, 2) = round(transaction.amount, 2)
  AND (
    NOT EXISTS (
      SELECT 1
      FROM public.money_line_items AS sibling
      WHERE sibling.transaction_id = line_item.transaction_id
        AND sibling.id <> line_item.id
    )
    OR round(
      COALESCE(
        (
          SELECT sum(sibling.amount)
          FROM public.money_line_items AS sibling
          WHERE sibling.transaction_id = line_item.transaction_id
            AND sibling.id <> line_item.id
            AND sibling.line_status <> 'cancelled'
        ),
        0
      ),
      2
    ) = round(transaction.amount, 2)
  );

-- One-off cleanup of transactions the missing repair call already corrupted.
--
-- `apply-batch` never called `repairExistingTransactionDetails`, so a re-import that finally
-- delivered a real receipt added its lines next to the placeholder instead of replacing it,
-- and the transaction's spending counted twice. These rows cannot heal on their own: the
-- transaction now has real line items, so `get_existing_transaction_states` reports it as
-- fulfilled and the extension skips it forever.
--
-- Line items a human edited are left alone even when they look like placeholders. Removing a
-- manual edit automatically is worse than leaving a visible discrepancy for that transaction.
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
  );
