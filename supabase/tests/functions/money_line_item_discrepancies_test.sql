BEGIN;
SELECT plan(4);

SELECT has_function(
  'public',
  'money_list_line_item_discrepancies',
  ARRAY['uuid', 'numeric']
);

INSERT INTO public.persons (id, name, kind)
VALUES ('a1000000-0000-4000-8000-000000000001', 'Discrepancy Tester', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001',
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
  merchant_name
)
VALUES
  (
    'a1000000-0000-4000-8000-000000000010',
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'manual',
    '2026-01-02T12:00:00Z',
    100,
    'RUB',
    'expense',
    'posted',
    'Mismatch Shop'
  ),
  (
    'a1000000-0000-4000-8000-000000000011',
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'manual',
    '2026-01-03T12:00:00Z',
    50,
    'RUB',
    'expense',
    'posted',
    'Balanced Shop'
  );

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  line_status,
  assignment_method
)
VALUES
  (
    'a1000000-0000-4000-8000-000000000020',
    'a1000000-0000-4000-8000-000000000010',
    'Item A',
    40,
    'final',
    'import'
  ),
  (
    'a1000000-0000-4000-8000-000000000021',
    'a1000000-0000-4000-8000-000000000010',
    'Cancelled ignored',
    1000,
    'cancelled',
    'import'
  ),
  (
    'a1000000-0000-4000-8000-000000000022',
    'a1000000-0000-4000-8000-000000000011',
    'Exact',
    50,
    'final',
    'import'
  );

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.money_list_line_item_discrepancies(
      'a1000000-0000-4000-8000-000000000001'::uuid,
      0.01
    )
  ),
  1,
  'only mismatched transactions are listed'
);

SELECT results_eq(
  $$
    SELECT transaction_id, amount, line_items_sum, delta
    FROM public.money_list_line_item_discrepancies(
      'a1000000-0000-4000-8000-000000000001'::uuid,
      0.01
    )
  $$,
  $$
    VALUES (
      'a1000000-0000-4000-8000-000000000010'::uuid,
      100::numeric,
      40::numeric,
      60::numeric
    )
  $$,
  'delta ignores cancelled line items'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.money_list_line_item_discrepancies(
      'a1000000-0000-4000-8000-000000000001'::uuid,
      100
    )
  ),
  0,
  'min delta filters small mismatches'
);

SELECT * FROM finish();
ROLLBACK;
