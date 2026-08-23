BEGIN;
SELECT plan(7);

SELECT has_function('public', 'money_list_line_item_discrepancies', ARRAY['uuid', 'numeric']);
SELECT has_column('public', 'money_line_items', 'is_placeholder', 'money_line_items exposes the placeholder flag');

INSERT INTO public.persons (id, name, kind)
VALUES ('7c000000-0000-0000-0000-000000000010', 'Discrepancy owner', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '7c000000-0000-0000-0000-000000000020',
  '7c000000-0000-0000-0000-000000000010',
  'manual',
  'debit',
  'Discrepancy account',
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
  merchant_name,
  is_transfer,
  dedupe_hash
)
VALUES
  -- Balanced: line items add up to the transaction amount.
  (
    '7c000000-0000-0000-0000-000000000101',
    '7c000000-0000-0000-0000-000000000010',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-05T10:00:00Z',
    -1000,
    'RUB',
    'expense',
    'posted',
    'Balanced store',
    false,
    'discrepancy-hash-1'
  ),
  -- Doubled: a placeholder survived next to the real receipt.
  (
    '7c000000-0000-0000-0000-000000000102',
    '7c000000-0000-0000-0000-000000000010',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-06T10:00:00Z',
    -1000,
    'RUB',
    'expense',
    'posted',
    'Doubled store',
    false,
    'discrepancy-hash-2'
  ),
  -- Cancelled lines must not count towards the sum.
  (
    '7c000000-0000-0000-0000-000000000103',
    '7c000000-0000-0000-0000-000000000010',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-07T10:00:00Z',
    -500,
    'RUB',
    'expense',
    'posted',
    'Cancelled line store',
    false,
    'discrepancy-hash-3'
  );

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  line_status,
  assignment_method,
  is_placeholder
)
VALUES
  ('7c000000-0000-0000-0000-000000000201', '7c000000-0000-0000-0000-000000000101', 'Молоко', -400, 'final', 'import', false),
  ('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-000000000101', 'Хлеб', -600, 'final', 'import', false),
  ('7c000000-0000-0000-0000-000000000203', '7c000000-0000-0000-0000-000000000102', 'Doubled store', -1000, 'final', 'import', true),
  ('7c000000-0000-0000-0000-000000000204', '7c000000-0000-0000-0000-000000000102', 'Молоко', -400, 'final', 'import', false),
  ('7c000000-0000-0000-0000-000000000205', '7c000000-0000-0000-0000-000000000102', 'Хлеб', -600, 'final', 'import', false),
  ('7c000000-0000-0000-0000-000000000206', '7c000000-0000-0000-0000-000000000103', 'Возврат', -500, 'final', 'import', false),
  ('7c000000-0000-0000-0000-000000000207', '7c000000-0000-0000-0000-000000000103', 'Отменённая позиция', -900, 'cancelled', 'import', false);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
  ),
  1::bigint,
  'only the doubled transaction is reported as a discrepancy'
);

SELECT is(
  (
    SELECT transaction_id
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
  ),
  '7c000000-0000-0000-0000-000000000102'::uuid,
  'the reported row is the transaction whose placeholder was never replaced'
);

SELECT is(
  (
    SELECT delta
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
  ),
  1000::numeric,
  'delta is the amount the line items over-explain'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_list_line_item_discrepancies(
      '7c000000-0000-0000-0000-000000000010',
      2000
    )
  ),
  0::bigint,
  'p_min_delta filters out discrepancies below the requested threshold'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000099')
  ),
  0::bigint,
  'the report is scoped to the requested person'
);

SELECT * FROM finish();
ROLLBACK;
