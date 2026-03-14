BEGIN;
SELECT plan(20);

SELECT has_function('public', 'money_normalize_transfer_text', ARRAY['text']);
SELECT has_function('public', 'money_person_self_transfer_variants', ARRAY['uuid']);
SELECT has_function('public', 'money_resolve_fx_rate', ARRAY['date', 'character', 'character']);
SELECT has_function('public', 'money_get_budget_report', ARRAY['uuid', 'date', 'character']);

INSERT INTO public.persons (id, name, kind)
VALUES ('7b000000-0000-0000-0000-000000000010', 'Максим Подрешетников', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '7b000000-0000-0000-0000-000000000020',
  '7b000000-0000-0000-0000-000000000010',
  'manual',
  'debit',
  'Budget report account',
  'RUB'
);

INSERT INTO public.money_categories (
  id,
  parent_id,
  canonical_category_id,
  category_kind,
  depth,
  name_ru,
  name_en,
  slug
)
SELECT
  '7b000000-0000-0000-0000-000000000030',
  canonical.id,
  canonical.id,
  'custom',
  2,
  'Домашняя еда',
  'Home food',
  'budget-report-home-food'
FROM public.money_categories AS canonical
WHERE canonical.system_key = 'food';

INSERT INTO public.money_transfer_self_aliases (
  id,
  person_id,
  alias,
  normalized_alias
)
VALUES (
  '7b000000-0000-0000-0000-000000000031',
  '7b000000-0000-0000-0000-000000000010',
  'Макс П',
  'placeholder'
);

DELETE FROM public.money_fx_rates;

INSERT INTO public.money_fx_rates (
  rate_date,
  base_currency,
  quote_currency,
  rate
)
VALUES
  ('2026-03-01', 'USD', 'RUB', 88),
  ('2026-03-19', 'USD', 'RUB', 90);

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
  comment,
  source_comment,
  is_transfer,
  dedupe_hash
)
VALUES
  (
    '7b000000-0000-0000-0000-000000000101',
    '7b000000-0000-0000-0000-000000000010',
    '7b000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-05T10:00:00Z',
    -1100,
    'RUB',
    'expense',
    'posted',
    'Food store',
    NULL,
    NULL,
    false,
    'budget-report-hash-1'
  ),
  (
    '7b000000-0000-0000-0000-000000000102',
    '7b000000-0000-0000-0000-000000000010',
    '7b000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-06T12:00:00Z',
    -500,
    'RUB',
    'transfer',
    'pending',
    'Transfer to wife',
    NULL,
    'Жена',
    true,
    'budget-report-hash-2'
  ),
  (
    '7b000000-0000-0000-0000-000000000103',
    '7b000000-0000-0000-0000-000000000010',
    '7b000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-06T14:00:00Z',
    -700,
    'RUB',
    'transfer',
    'posted',
    'Self transfer generated',
    NULL,
    'Подрешетников М.',
    true,
    'budget-report-hash-3'
  ),
  (
    '7b000000-0000-0000-0000-000000000104',
    '7b000000-0000-0000-0000-000000000010',
    '7b000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-07T09:00:00Z',
    2000,
    'RUB',
    'income',
    'posted',
    'Salary',
    NULL,
    NULL,
    false,
    'budget-report-hash-4'
  ),
  (
    '7b000000-0000-0000-0000-000000000105',
    '7b000000-0000-0000-0000-000000000010',
    '7b000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-08T09:00:00Z',
    -10,
    'RUB',
    'expense',
    'posted',
    'Returned item',
    NULL,
    NULL,
    false,
    'budget-report-hash-5'
  ),
  (
    '7b000000-0000-0000-0000-000000000106',
    '7b000000-0000-0000-0000-000000000010',
    '7b000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-20T09:00:00Z',
    -20,
    'USD',
    'expense',
    'posted',
    'Taxi',
    NULL,
    NULL,
    false,
    'budget-report-hash-6'
  ),
  (
    '7b000000-0000-0000-0000-000000000107',
    '7b000000-0000-0000-0000-000000000010',
    '7b000000-0000-0000-0000-000000000020',
    'manual',
    '2026-03-09T10:00:00Z',
    -50,
    'RUB',
    'transfer',
    'posted',
    'Self transfer alias',
    NULL,
    'Макс П',
    true,
    'budget-report-hash-7'
  );

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  line_status,
  category_id
)
VALUES
  (
    '7b000000-0000-0000-0000-000000000201',
    '7b000000-0000-0000-0000-000000000101',
    'Groceries',
    -100,
    'final',
    (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1)
  ),
  (
    '7b000000-0000-0000-0000-000000000202',
    '7b000000-0000-0000-0000-000000000101',
    'Ignored cancelled line',
    -1000,
    'cancelled',
    (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1)
  ),
  (
    '7b000000-0000-0000-0000-000000000203',
    '7b000000-0000-0000-0000-000000000105',
    'Returned medicine',
    -10,
    'returned',
    (SELECT id FROM public.money_categories WHERE system_key = 'health' LIMIT 1)
  ),
  (
    '7b000000-0000-0000-0000-000000000204',
    '7b000000-0000-0000-0000-000000000106',
    'Taxi ride',
    -20,
    'final',
    (SELECT id FROM public.money_categories WHERE system_key = 'transport' LIMIT 1)
  );

INSERT INTO public.money_budget_targets (
  id,
  person_id,
  category_id,
  month_start,
  target_amount,
  currency
)
VALUES
  (
    '7b000000-0000-0000-0000-000000000301',
    '7b000000-0000-0000-0000-000000000010',
    (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1),
    '2026-03-01',
    -1500,
    'RUB'
  ),
  (
    '7b000000-0000-0000-0000-000000000302',
    '7b000000-0000-0000-0000-000000000010',
    (SELECT id FROM public.money_categories WHERE system_key = 'transport' LIMIT 1),
    '2026-03-01',
    -20,
    'USD'
  ),
  (
    '7b000000-0000-0000-0000-000000000303',
    '7b000000-0000-0000-0000-000000000010',
    (SELECT id FROM public.money_categories WHERE system_key = 'income' LIMIT 1),
    '2026-03-01',
    2500,
    'RUB'
  );

SELECT is(
  public.money_normalize_transfer_text('  Подрёшетников М.  '),
  'подрешетниковм',
  'money_normalize_transfer_text lowercases, replaces ё, and strips punctuation and spaces'
);

SELECT is(
  (
    SELECT normalized_alias
    FROM public.money_person_self_transfer_variants('7b000000-0000-0000-0000-000000000010')
    WHERE normalized_alias = 'максимподрешетников'
    LIMIT 1
  ),
  'максимподрешетников',
  'person self-transfer variants include the compact full name'
);

SELECT is(
  (
    SELECT normalized_alias
    FROM public.money_person_self_transfer_variants('7b000000-0000-0000-0000-000000000010')
    WHERE normalized_alias = 'подрешетниковм'
    LIMIT 1
  ),
  'подрешетниковм',
  'person self-transfer variants include surname plus first initial'
);

SELECT is(
  (
    SELECT normalized_alias
    FROM public.money_transfer_self_aliases
    WHERE id = '7b000000-0000-0000-0000-000000000031'
  ),
  'максп',
  'self-transfer alias trigger stores normalized_alias'
);

SELECT throws_ok(
  $$
    INSERT INTO public.money_budget_targets (
      person_id,
      category_id,
      month_start,
      target_amount,
      currency
    ) VALUES (
      '7b000000-0000-0000-0000-000000000010',
      '7b000000-0000-0000-0000-000000000030',
      '2026-03-01',
      -300,
      'RUB'
    )
  $$,
  'Budget targets cannot overlap across ancestor or descendant categories in the same month',
  'budget targets reject ancestor or descendant overlap within the same month'
);

SELECT is(
  (
    SELECT rate
    FROM public.money_resolve_fx_rate('2026-03-01', 'USD', 'RUB')
  ),
  88::numeric,
  'money_resolve_fx_rate returns an exact direct rate'
);

SELECT is(
  (
    SELECT rate
    FROM public.money_resolve_fx_rate('2026-03-20', 'USD', 'RUB')
  ),
  90::numeric,
  'money_resolve_fx_rate falls back to the nearest previous direct rate'
);

SELECT is(
  (
    SELECT round(rate::numeric, 8)
    FROM public.money_resolve_fx_rate('2026-03-20', 'RUB', 'USD')
  ),
  round((1::numeric / 90::numeric), 8),
  'money_resolve_fx_rate supports inverse fallback when only the reverse pair exists'
);

SELECT is(
  (
    SELECT actual_income
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'RUB'
    )
  ),
  2000::numeric,
  'budget report includes posted income and synthesized uncategorized rows'
);

SELECT is(
  (
    SELECT actual_expense
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'RUB'
    )
  ),
  -2410::numeric,
  'budget report includes pending transfers to others, excludes self transfers, and ignores cancelled line items'
);

SELECT is(
  (
    SELECT target_net
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'RUB'
    )
  ),
  -760::numeric,
  'budget report converts targets into the report currency using month_start rates'
);

SELECT is(
  (
    SELECT fx_status ->> 'status'
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'RUB'
    )
  ),
  'approximated',
  'budget report marks the FX status as approximated when prior-day fallback is used'
);

SELECT is(
  (
    SELECT (row_payload ->> 'actual_net')::numeric
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'RUB'
    ) AS report,
    LATERAL jsonb_array_elements(report.category_rows) AS row_payload
    WHERE row_payload ->> 'system_key' = 'uncategorized'
  ),
  1500::numeric,
  'budget report maps synthesized no-line-item amounts into the uncategorized bucket'
);

SELECT is(
  (
    SELECT actual_net
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'RUB'
    )
  ),
  -410::numeric,
  'budget report excludes self-transfer amounts from the final totals'
);

SELECT is(
  (
    SELECT fx_status ->> 'status'
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'EUR'
    )
  ),
  'error',
  'budget report returns a blocking FX status when required conversions are missing'
);

SELECT ok(
  (
    SELECT actual_net IS NULL
    FROM public.money_get_budget_report(
      '7b000000-0000-0000-0000-000000000010',
      '2026-03-01',
      'EUR'
    )
  ),
  'budget report suppresses totals when FX data is missing'
);

SELECT * FROM finish();
ROLLBACK;
