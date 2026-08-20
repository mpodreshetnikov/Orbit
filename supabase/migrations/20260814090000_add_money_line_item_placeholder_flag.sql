-- Explicit placeholder flag for money line items.
--
-- A "placeholder" line item is the single whole-amount row the import creates when the receipt
-- composition could not be obtained. Until now placeholders were recognised only by the private
-- `source` key inside `raw_payload` ("fallback" / "dom_fallback"), which the browser extension
-- writes. Rows created by the CSV statement import carry the raw statement row in `raw_payload`
-- and therefore have no such key, so they were never recognised and never replaced by a real
-- receipt. An explicit column removes the dependency on the shape of third-party payloads,
-- can be indexed, and lets already accumulated rows be labelled once.

ALTER TABLE public.money_line_items
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_money_line_items_placeholder
  ON public.money_line_items(transaction_id)
  WHERE is_placeholder;

-- Label already accumulated rows. A row is a placeholder when EITHER of the two shapes holds.

-- Shape 1: the extension's own marker inside the raw payload.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
WHERE NOT line_item.is_placeholder
  AND lower(btrim(COALESCE(line_item.raw_payload->>'source', ''))) IN ('fallback', 'dom_fallback');

-- Shape 2: the CSV import's whole-amount stand-in — the only line item of its transaction, created
-- by an import, matching the transaction amount, and never touched by a human.
--
-- This can also catch a genuine single-line receipt. That is safe: at the next enrichment such a
-- row is deleted and immediately re-inserted with identical content, because `import_hash` is
-- computed from the content. Nothing is lost and no duplicate appears.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
FROM public.money_transactions AS transaction
WHERE transaction.id = line_item.transaction_id
  AND NOT line_item.is_placeholder
  AND line_item.assignment_method = 'import'
  AND line_item.import_hash IS NOT NULL
  AND NOT line_item.category_locked_by_user
  AND line_item.amount = transaction.amount
  AND NOT EXISTS (
    SELECT 1
    FROM public.money_line_items AS sibling
    WHERE sibling.transaction_id = line_item.transaction_id
      AND sibling.id <> line_item.id
  );

-- One-off repair of transactions already damaged by the missing repair call in the live apply path:
-- the placeholder and the real receipt lines sit side by side and are summed twice. These do not
-- self-heal, because the presence of real line items makes `get_existing_transaction_states` report
-- the transaction as fulfilled, so the extension skips it and no re-import ever reaches it.
--
-- The `category_locked_by_user` and `assignment_method` guards protect rows a human edited: those
-- are left alone even when they look like a placeholder, and the transaction stays visible in
-- `money_list_line_item_discrepancies` for manual resolution. Deleting a human's edit automatically
-- is worse than leaving a visible discrepancy.
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
