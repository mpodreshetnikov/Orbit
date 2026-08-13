BEGIN;
SELECT plan(9);

SELECT has_function('public', 'money_list_line_item_discrepancies', ARRAY['uuid', 'numeric']);

INSERT INTO public.persons (id, name, kind)
VALUES
  ('7c000000-0000-0000-0000-000000000010', 'Discrepancy owner', 'human'),
  ('7c000000-0000-0000-0000-000000000011', 'Other person', 'human');

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
  -- Balanced: line items sum exactly to the transaction amount.
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
  -- Damaged: a placeholder left next to the real receipt lines, so the sum is doubled.
  (
    '7c000000-0000-0000-0000-000000000102',
    '7c000000-0000-0000-0000-000000000010',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-06T10:00:00Z',
    -500,
    'RUB',
    'expense',
    'posted',
    'Doubled store',
    false,
    'discrepancy-hash-2'
  ),
  -- Small difference below the default threshold.
  (
    '7c000000-0000-0000-0000-000000000103',
    '7c000000-0000-0000-0000-000000000010',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-07T10:00:00Z',
    -100.005,
    'RUB',
    'expense',
    'posted',
    'Rounding store',
    false,
    'discrepancy-hash-3'
  ),
  -- No line items at all: not a discrepancy, the budget report counts the header amount.
  (
    '7c000000-0000-0000-0000-000000000104',
    '7c000000-0000-0000-0000-000000000010',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-08T10:00:00Z',
    -900,
    'RUB',
    'expense',
    'posted',
    'No composition store',
    false,
    'discrepancy-hash-4'
  ),
  -- Cancelled lines must not count towards the sum.
  (
    '7c000000-0000-0000-0000-000000000105',
    '7c000000-0000-0000-0000-000000000010',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-09T10:00:00Z',
    -300,
    'RUB',
    'expense',
    'posted',
    'Cancelled line store',
    false,
    'discrepancy-hash-5'
  ),
  -- Belongs to another person and must never appear for this one.
  (
    '7c000000-0000-0000-0000-000000000106',
    '7c000000-0000-0000-0000-000000000011',
    '7c000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-10T10:00:00Z',
    -700,
    'RUB',
    'expense',
    'posted',
    'Other person store',
    false,
    'discrepancy-hash-6'
  );

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  line_status,
  is_placeholder
)
VALUES
  ('7c000000-0000-0000-0000-000000000201', '7c000000-0000-0000-0000-000000000101', 'Milk', -400, 'final', false),
  ('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-000000000101', 'Bread', -600, 'final', false),
  ('7c000000-0000-0000-0000-000000000203', '7c000000-0000-0000-0000-000000000102', 'Whole amount', -500, 'final', true),
  ('7c000000-0000-0000-0000-000000000204', '7c000000-0000-0000-0000-000000000102', 'Shampoo', -200, 'final', false),
  ('7c000000-0000-0000-0000-000000000205', '7c000000-0000-0000-0000-000000000102', 'Dog food', -300, 'final', false),
  ('7c000000-0000-0000-0000-000000000206', '7c000000-0000-0000-0000-000000000103', 'Almost exact', -100, 'final', false),
  ('7c000000-0000-0000-0000-000000000207', '7c000000-0000-0000-0000-000000000105', 'Counted', -300, 'final', false),
  ('7c000000-0000-0000-0000-000000000208', '7c000000-0000-0000-0000-000000000105', 'Cancelled', -1000, 'cancelled', false),
  ('7c000000-0000-0000-0000-000000000209', '7c000000-0000-0000-0000-000000000106', 'Other person line', -100, 'final', false);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
  ),
  1,
  'only the transaction whose line items do not sum to its amount is reported'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
    WHERE transaction_id = '7c000000-0000-0000-0000-000000000102'
  ),
  1,
  'the transaction with a leftover placeholder is reported'
);

SELECT is(
  (
    SELECT delta
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
    WHERE transaction_id = '7c000000-0000-0000-0000-000000000102'
  ),
  500::numeric,
  'delta is the transaction amount minus the line items sum'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
    WHERE transaction_id = '7c000000-0000-0000-0000-000000000101'
  ),
  0,
  'a balanced transaction is not reported'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
    WHERE transaction_id = '7c000000-0000-0000-0000-000000000103'
  ),
  0,
  'a difference below the default threshold is not reported'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010', 0.001)
    WHERE transaction_id = '7c000000-0000-0000-0000-000000000103'
  ),
  1,
  'a lower threshold surfaces the rounding difference'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
    WHERE transaction_id = '7c000000-0000-0000-0000-000000000104'
  ),
  0,
  'a transaction without any line items is not reported'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.money_list_line_item_discrepancies('7c000000-0000-0000-0000-000000000010')
    WHERE transaction_id = '7c000000-0000-0000-0000-000000000106'
  ),
  0,
  'another person transactions are never reported'
);

SELECT * FROM finish();
ROLLBACK;
