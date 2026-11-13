BEGIN;
SELECT plan(4);

SELECT has_column(
  'public',
  'money_line_items',
  'is_placeholder',
  'money_line_items has is_placeholder for synthetic stubs'
);

INSERT INTO public.persons (id, name, kind)
VALUES ('b1000000-0000-4000-8000-000000000001', 'Placeholder Backfill Tester', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  'b1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001',
  'manual',
  'debit',
  'Placeholder account',
  'RUB'
);

INSERT INTO public.money_transactions (
  id,
  payer_person_id,
  account_id,
  source,
  posted_at,
  amount,
  currency,
  transaction_type,
  status,
  merchant_name
)
VALUES
  (
    'b1000000-0000-4000-8000-000000000010',
    'b1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    'tbank_web',
    '2026-01-02T12:00:00Z',
    100,
    'RUB',
    'expense',
    'posted',
    'Extension Stub Shop'
  ),
  (
    'b1000000-0000-4000-8000-000000000011',
    'b1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    'tbank',
    '2026-01-03T12:00:00Z',
    250,
    'RUB',
    'expense',
    'posted',
    'CSV Stub Shop'
  ),
  (
    'b1000000-0000-4000-8000-000000000012',
    'b1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    'tbank_web',
    '2026-01-04T12:00:00Z',
    80,
    'RUB',
    'expense',
    'posted',
    'Genuine Receipt Shop'
  );

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  line_status,
  assignment_method,
  import_hash,
  is_placeholder,
  category_locked_by_user,
  raw_payload
)
VALUES
  (
    'b1000000-0000-4000-8000-000000000020',
    'b1000000-0000-4000-8000-000000000010',
    'Extension Stub Shop',
    100,
    'final',
    'import',
    'hash-ext',
    false,
    false,
    '{"source":"fallback"}'::jsonb
  ),
  (
    'b1000000-0000-4000-8000-000000000021',
    'b1000000-0000-4000-8000-000000000011',
    'CSV Stub Shop',
    250,
    'final',
    'import',
    'hash-csv',
    false,
    false,
    '{"Дата операции":"01.01.2026 12:00:00","Описание":"CSV Stub Shop"}'::jsonb
  ),
  (
    'b1000000-0000-4000-8000-000000000022',
    'b1000000-0000-4000-8000-000000000012',
    'Genuine single receipt',
    80,
    'final',
    'import',
    'hash-receipt',
    false,
    false,
    '{"source":"receipt","sku":"ABC"}'::jsonb
  );

-- Replay migration backfill predicates against fixtures.
UPDATE public.money_line_items AS line_item
SET is_placeholder = true
WHERE COALESCE(line_item.raw_payload->>'source', '') IN ('fallback', 'dom_fallback');

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

SELECT is(
  (
    SELECT is_placeholder
    FROM public.money_line_items
    WHERE id = 'b1000000-0000-4000-8000-000000000020'
  ),
  true,
  'extension fallback stub is marked placeholder'
);

SELECT is(
  (
    SELECT is_placeholder
    FROM public.money_line_items
    WHERE id = 'b1000000-0000-4000-8000-000000000021'
  ),
  true,
  'historical tbank CSV stub with column keys is marked placeholder'
);

SELECT is(
  (
    SELECT is_placeholder
    FROM public.money_line_items
    WHERE id = 'b1000000-0000-4000-8000-000000000022'
  ),
  false,
  'genuine single-item receipt is not marked placeholder'
);

SELECT * FROM finish();
ROLLBACK;
