BEGIN;
SELECT plan(19);

SELECT has_function(
  'public',
  'money_get_spending_report',
  ARRAY['uuid', 'date', 'date', 'character', 'uuid[]', 'uuid', 'date']
);

INSERT INTO public.persons (id, name, kind)
VALUES ('7c000000-0000-0000-0000-000000000010', 'Максим Подрешетников', 'human');

INSERT INTO public.money_accounts (id, owner_person_id, source, account_kind, account_label, currency)
VALUES
  ('7c000000-0000-0000-0000-000000000020', '7c000000-0000-0000-0000-000000000010', 'manual', 'debit', 'Spending report A', 'RUB'),
  ('7c000000-0000-0000-0000-000000000021', '7c000000-0000-0000-0000-000000000010', 'manual', 'debit', 'Spending report B', 'RUB');

INSERT INTO public.money_transfer_self_aliases (id, person_id, alias, normalized_alias)
VALUES ('7c000000-0000-0000-0000-000000000031', '7c000000-0000-0000-0000-000000000010', 'Макс П', 'placeholder');

DELETE FROM public.money_fx_rates;
INSERT INTO public.money_fx_rates (rate_date, base_currency, quote_currency, rate)
VALUES ('2026-03-15', 'USD', 'RUB', 90);

INSERT INTO public.money_transactions (
  id, payer_person_id, account_id, source, posted_at, amount, currency, transaction_type, status,
  merchant_name, source_comment, is_transfer, dedupe_hash
)
VALUES
  -- In the period (2026-03): food 1000 on A, an uncategorized cafe 300 on B, income 5000 on A,
  -- a transfer to oneself that never counts, and 10 USD of health at 90.
  ('7c000000-0000-0000-0000-000000000101', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000020',
   'manual', '2026-03-05T10:00:00Z', -1000, 'RUB', 'expense', 'posted', 'Food store', NULL, false, 'spending-report-1'),
  ('7c000000-0000-0000-0000-000000000102', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000021',
   'manual', '2026-03-10T10:00:00Z', -300, 'RUB', 'expense', 'pending', 'Cafe X', NULL, false, 'spending-report-2'),
  ('7c000000-0000-0000-0000-000000000103', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000020',
   'manual', '2026-03-12T10:00:00Z', 5000, 'RUB', 'income', 'posted', 'Employer', NULL, false, 'spending-report-3'),
  ('7c000000-0000-0000-0000-000000000104', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000020',
   'manual', '2026-03-06T10:00:00Z', -700, 'RUB', 'transfer', 'posted', 'Self', 'Макс П', true, 'spending-report-4'),
  ('7c000000-0000-0000-0000-000000000105', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000020',
   'manual', '2026-03-15T10:00:00Z', -10, 'USD', 'expense', 'posted', 'Pharmacy', NULL, false, 'spending-report-5'),
  -- The previous period of the same length (2026-01-29 .. 2026-02-28): food 400.
  ('7c000000-0000-0000-0000-000000000106', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000020',
   'manual', '2026-02-10T10:00:00Z', -400, 'RUB', 'expense', 'posted', 'Food store', NULL, false, 'spending-report-6'),
  -- Last year: food 3650, so an average 31-day period is 310.
  ('7c000000-0000-0000-0000-000000000107', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000020',
   'manual', '2025-06-01T10:00:00Z', -3650, 'RUB', 'expense', 'posted', 'Food store', NULL, false, 'spending-report-7'),
  -- Cancelled, never counts.
  ('7c000000-0000-0000-0000-000000000108', '7c000000-0000-0000-0000-000000000010', '7c000000-0000-0000-0000-000000000020',
   'manual', '2026-03-07T10:00:00Z', -9999, 'RUB', 'expense', 'cancelled', 'Food store', NULL, false, 'spending-report-8');

INSERT INTO public.money_line_items (id, transaction_id, title, amount, line_status, category_id)
VALUES
  ('7c000000-0000-0000-0000-000000000201', '7c000000-0000-0000-0000-000000000101', 'Groceries', -1000, 'final',
   (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1)),
  ('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-000000000105', 'Medicine', -10, 'final',
   (SELECT id FROM public.money_categories WHERE system_key = 'health' LIMIT 1)),
  ('7c000000-0000-0000-0000-000000000203', '7c000000-0000-0000-0000-000000000106', 'Groceries', -400, 'final',
   (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1)),
  ('7c000000-0000-0000-0000-000000000204', '7c000000-0000-0000-0000-000000000107', 'Groceries', -3650, 'final',
   (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1));

CREATE TEMP TABLE report AS
SELECT public.money_get_spending_report(
  '7c000000-0000-0000-0000-000000000010', '2026-03-01', '2026-03-31', 'RUB', NULL, NULL, '2026-03-20'
) AS body;

SELECT is((SELECT (body -> 'totals' ->> 'expense')::numeric FROM report), 2200::numeric,
  'the period spends food, the cafe and the converted pharmacy, not the transfer to oneself or the cancelled one');
SELECT is((SELECT (body -> 'totals' ->> 'income')::numeric FROM report), 5000::numeric, 'income is counted apart');
SELECT is((SELECT (body -> 'totals' ->> 'net')::numeric FROM report), 2800::numeric, 'net is income less spending');
SELECT is((SELECT (body -> 'totals' ->> 'previous_expense')::numeric FROM report), 400::numeric,
  'the previous period is the 31 days before the period');
SELECT is((SELECT round((body -> 'totals' ->> 'last_year_expense')::numeric, 2) FROM report), 310.00::numeric,
  'last year''s average is its total scaled to the period''s length');
SELECT is((SELECT body -> 'period' ->> 'previous_start' FROM report), '2026-01-29', 'the previous period starts 31 days back');

SELECT is((SELECT round((body -> 'forecast' ->> 'expense')::numeric, 2) FROM report), 2550.00::numeric,
  'the forecast adds each remaining day''s weekday average over twelve weeks');
SELECT is((SELECT (body -> 'forecast' ->> 'days_left')::integer FROM report), 11, 'eleven days are left after the 20th');
SELECT is(
  (SELECT body -> 'forecast' FROM (
    SELECT public.money_get_spending_report(
      '7c000000-0000-0000-0000-000000000010', '2026-02-01', '2026-02-28', 'RUB', NULL, NULL, '2026-03-20'
    ) AS body
  ) AS past),
  'null'::jsonb,
  'a period already over has no forecast'
);

SELECT is(
  (SELECT (category ->> 'expense')::numeric
   FROM report, jsonb_array_elements(body -> 'categories') AS category
   WHERE category ->> 'system_key' = 'food'),
  1000::numeric,
  'food spent 1000'
);
SELECT is(
  (SELECT (category ->> 'previous_expense')::numeric
   FROM report, jsonb_array_elements(body -> 'categories') AS category
   WHERE category ->> 'system_key' = 'food'),
  400::numeric,
  'food carries its previous period'
);
SELECT is(
  (SELECT jsonb_array_length(category -> 'months')
   FROM report, jsonb_array_elements(body -> 'categories') AS category
   WHERE category ->> 'system_key' = 'food'),
  12,
  'every category carries twelve months'
);
SELECT is(
  (SELECT (category -> 'months' -> 11 ->> 'expense')::numeric
   FROM report, jsonb_array_elements(body -> 'categories') AS category
   WHERE category ->> 'system_key' = 'food'),
  1000::numeric,
  'the last month is the period''s own month'
);

SELECT is(
  (SELECT array_agg(merchant ->> 'name' ORDER BY ordinality)
   FROM report, jsonb_array_elements(body -> 'merchants') WITH ORDINALITY AS merchants(merchant, ordinality)),
  ARRAY['Food store', 'Pharmacy', 'Cafe X'],
  'merchants come by spending, largest first'
);

SELECT is((SELECT jsonb_array_length(body -> 'days') FROM report), 31, 'one point per day of the period');

SELECT is(
  (SELECT (public.money_get_spending_report(
    '7c000000-0000-0000-0000-000000000010', '2026-03-01', '2026-03-31', 'RUB',
    ARRAY['7c000000-0000-0000-0000-000000000021']::uuid[], NULL, '2026-03-20'
  ) -> 'totals' ->> 'expense')::numeric),
  300::numeric,
  'an account filter keeps only that account''s spending'
);

SELECT is(
  (SELECT (public.money_get_spending_report(
    '7c000000-0000-0000-0000-000000000010', '2026-03-01', '2026-03-31', 'RUB', NULL,
    (SELECT id FROM public.money_categories WHERE system_key = 'food' LIMIT 1), '2026-03-20'
  ) -> 'totals' ->> 'expense')::numeric),
  1000::numeric,
  'a category filter keeps only that category''s branch'
);

SELECT throws_ok(
  $$SELECT public.money_get_spending_report('7c000000-0000-0000-0000-000000000010', '2026-03-31', '2026-03-01')$$,
  'p_start and p_end are required and p_end may not be before p_start'
);

SELECT * FROM finish();
ROLLBACK;
