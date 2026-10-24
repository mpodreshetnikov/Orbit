BEGIN;
SELECT plan(14);

SELECT ok(
  to_regprocedure('public.money_update_transaction_with_lines(uuid,jsonb,jsonb)') IS NOT NULL,
  'money_update_transaction_with_lines exists'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('74000000-0000-0000-0000-000000000001', 'money-update@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('74000000-0000-0000-0000-000000000001', 'money-update@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('74000000-0000-0000-0000-000000000010', 'Money Update Person', 'human');

INSERT INTO public.money_accounts (id, owner_person_id, source, account_kind, account_label, currency)
VALUES
  ('74000000-0000-0000-0000-000000000101', '74000000-0000-0000-0000-000000000010', 'manual', 'debit', 'Rubles', 'RUB'),
  ('74000000-0000-0000-0000-000000000102', '74000000-0000-0000-0000-000000000010', 'manual', 'debit', 'Dollars', 'USD');

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
  dedupe_hash
)
VALUES
  ('74000000-0000-0000-0000-000000000401', '74000000-0000-0000-0000-000000000010', '74000000-0000-0000-0000-000000000101', 'manual', '2026-10-01T10:00:00Z', -300, 'RUB', 'expense', 'posted', 'Bakery', 'Bread and milk', 'update-hash-1'),
  ('74000000-0000-0000-0000-000000000402', '74000000-0000-0000-0000-000000000010', '74000000-0000-0000-0000-000000000101', 'manual', '2026-10-02T10:00:00Z', 1000, 'RUB', 'income', 'posted', 'Payroll', NULL, 'update-hash-2'),
  ('74000000-0000-0000-0000-000000000403', '74000000-0000-0000-0000-000000000010', '74000000-0000-0000-0000-000000000102', 'manual', '2026-10-03T10:00:00Z', -12.5, 'USD', 'expense', 'posted', 'App Store', NULL, 'update-hash-3');

INSERT INTO public.money_line_items (id, transaction_id, title, amount)
VALUES
  ('74000000-0000-0000-0000-000000000501', '74000000-0000-0000-0000-000000000401', 'Bread', -100),
  ('74000000-0000-0000-0000-000000000502', '74000000-0000-0000-0000-000000000401', 'Milk', -200);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-update@example.com', true);
SELECT set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000001', true);

-- 2026-10-24: the summary added rubles and dollars into one number. Each currency is its own row.
SELECT is(
  (
    SELECT jsonb_agg(
      jsonb_build_array(currency, total_count, total_positive_amount, total_negative_amount)
    )
    FROM public.money_transaction_feed_summary(
      '74000000-0000-0000-0000-000000000010'::uuid,
      NULL, NULL, NULL, NULL, NULL, 'all', 'all', NULL, NULL
    )
  ),
  '[["RUB", 2, 1000, -300], ["USD", 1, 0, -12.5]]'::jsonb,
  'summary reports each currency on its own row, the most frequent first'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_transaction_feed_summary(
      '74000000-0000-0000-0000-000000000010'::uuid,
      'nothing matches this', NULL, NULL, NULL, NULL, 'all', 'all', NULL, NULL
    )
  ),
  0::bigint,
  'summary returns no rows when nothing matches'
);

-- Change the amount and comment, change Bread, drop Milk, add Butter.
SELECT is(
  (
    SELECT jsonb_build_object(
      'amount', result -> 'transaction' -> 'amount',
      'comment', result -> 'transaction' -> 'comment',
      'merchant_name', result -> 'transaction' -> 'merchant_name',
      'titles', jsonb_path_query_array(result -> 'line_items', '$[*].title'),
      'first_id', result -> 'line_items' -> 0 -> 'id'
    )
    FROM public.money_update_transaction_with_lines(
      '74000000-0000-0000-0000-000000000401',
      '{"amount": -350.5, "comment": "Bread and butter"}'::jsonb,
      '[
        {"id": "74000000-0000-0000-0000-000000000501", "title": "Rye bread", "amount": -150.5},
        {"title": "Butter", "amount": -200, "quantity": 0.5, "unit": "kg"}
      ]'::jsonb
    ) AS result
  ),
  jsonb_build_object(
    'amount', -350.5,
    'comment', 'Bread and butter',
    'merchant_name', 'Bakery',
    'titles', '["Rye bread", "Butter"]'::jsonb,
    'first_id', '74000000-0000-0000-0000-000000000501'
  ),
  'update returns the changed transaction, keeping keys not given, and its lines in the order given'
);

SELECT is(
  (
    SELECT string_agg(title || ':' || amount::text, ',' ORDER BY title)
    FROM public.money_line_items
    WHERE transaction_id = '74000000-0000-0000-0000-000000000401'
  ),
  'Butter:-200,Rye bread:-150.5',
  'a line not given is removed, a given one changed, a new one added'
);

SELECT is(
  (
    SELECT jsonb_build_object('line_status', line_status, 'assignment_method', assignment_method, 'locked', category_locked_by_user)
    FROM public.money_line_items
    WHERE transaction_id = '74000000-0000-0000-0000-000000000401'
      AND title = 'Butter'
  ),
  '{"line_status": "final", "assignment_method": "manual", "locked": false}'::jsonb,
  'a new line takes the column defaults for what is not given'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_transaction_edit_audits
    WHERE transaction_id = '74000000-0000-0000-0000-000000000401'
  ),
  2::bigint,
  'the edit is audited once for the transaction and once for the changed line'
);

SELECT is(
  (
    SELECT payer_person_id::text
    FROM public.money_transactions
    WHERE id = '74000000-0000-0000-0000-000000000401'
  ),
  '74000000-0000-0000-0000-000000000010',
  'the payer is not changed by the updates'
);

SELECT lives_ok(
  $$
    SELECT public.money_update_transaction_with_lines(
      '74000000-0000-0000-0000-000000000401',
      '{"payer_person_id": "74000000-0000-0000-0000-000000000099"}'::jsonb,
      '[{"id": "74000000-0000-0000-0000-000000000501"}]'::jsonb
    )
  $$,
  'a payer in the updates is ignored rather than written'
);

SELECT is(
  (
    SELECT string_agg(title, ',')
    FROM public.money_line_items
    WHERE transaction_id = '74000000-0000-0000-0000-000000000401'
  ),
  'Rye bread',
  'a line given by id alone keeps its saved values'
);

-- A line that cannot be written takes the whole edit back with it.
SELECT throws_ok(
  $$
    SELECT public.money_update_transaction_with_lines(
      '74000000-0000-0000-0000-000000000401',
      '{"amount": -1}'::jsonb,
      '[{"title": null, "amount": -1}]'::jsonb
    )
  $$,
  '23502',
  NULL,
  'a line item that violates a constraint fails the update'
);

SELECT is(
  (
    SELECT jsonb_build_object(
      'amount', tx.amount,
      'lines', (SELECT string_agg(li.title, ',') FROM public.money_line_items AS li WHERE li.transaction_id = tx.id)
    )
    FROM public.money_transactions AS tx
    WHERE tx.id = '74000000-0000-0000-0000-000000000401'
  ),
  jsonb_build_object('amount', -350.5, 'lines', 'Rye bread'),
  'after a failed update the transaction and its lines are as they were'
);

SELECT throws_ok(
  $$
    SELECT public.money_update_transaction_with_lines(
      '74000000-0000-0000-0000-000000000499',
      '{}'::jsonb,
      '[]'::jsonb
    )
  $$,
  'P0001',
  'money transaction 74000000-0000-0000-0000-000000000499 not found',
  'an unknown transaction is refused'
);

SELECT throws_ok(
  $$
    SELECT public.money_update_transaction_with_lines(
      '74000000-0000-0000-0000-000000000401',
      '{}'::jsonb,
      '{}'::jsonb
    )
  $$,
  'P0001',
  'p_line_items must be a JSON array',
  'line items that are not an array are refused'
);

SELECT * FROM finish();
ROLLBACK;
