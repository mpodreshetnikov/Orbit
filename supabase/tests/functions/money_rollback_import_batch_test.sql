BEGIN;
SELECT plan(9);

SELECT ok(
  to_regprocedure('public.money_rollback_import_batch(uuid)') IS NOT NULL,
  'money_rollback_import_batch exists'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('75000000-0000-0000-0000-000000000001', 'money-rollback@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('75000000-0000-0000-0000-000000000001', 'money-rollback@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('75000000-0000-0000-0000-000000000010', 'Money Rollback Person', 'human');

INSERT INTO public.money_accounts (id, owner_person_id, source, account_kind, account_label, currency)
VALUES ('75000000-0000-0000-0000-000000000101', '75000000-0000-0000-0000-000000000010', 'tbank', 'debit', 'T-Bank', 'RUB');

-- 401 was there before the batch; the batch matched it and added one line item to it.
-- 402 and 403 are the batch's own.
INSERT INTO public.money_transactions (
  id, payer_person_id, account_id, source, posted_at, amount, currency, transaction_type, status,
  merchant_name, dedupe_hash
)
VALUES
  ('75000000-0000-0000-0000-000000000401', '75000000-0000-0000-0000-000000000010', '75000000-0000-0000-0000-000000000101', 'tbank', '2026-10-01T10:00:00Z', -300, 'RUB', 'expense', 'posted', 'Bakery', 'rollback-hash-1'),
  ('75000000-0000-0000-0000-000000000402', '75000000-0000-0000-0000-000000000010', '75000000-0000-0000-0000-000000000101', 'tbank', '2026-10-02T10:00:00Z', -120, 'RUB', 'expense', 'posted', 'Taxi', 'rollback-hash-2'),
  ('75000000-0000-0000-0000-000000000403', '75000000-0000-0000-0000-000000000010', '75000000-0000-0000-0000-000000000101', 'tbank', '2026-10-03T10:00:00Z', 1000, 'RUB', 'income', 'posted', 'Payroll', 'rollback-hash-3');

INSERT INTO public.money_line_items (id, transaction_id, title, amount)
VALUES
  ('75000000-0000-0000-0000-000000000501', '75000000-0000-0000-0000-000000000401', 'Bread', -100),
  ('75000000-0000-0000-0000-000000000502', '75000000-0000-0000-0000-000000000401', 'Milk', -200),
  ('75000000-0000-0000-0000-000000000503', '75000000-0000-0000-0000-000000000402', 'Ride', -120),
  ('75000000-0000-0000-0000-000000000504', '75000000-0000-0000-0000-000000000403', 'Salary', 1000);

INSERT INTO public.money_import_batches (id, source, payer_person_id, import_type, status, meta)
VALUES
  ('75000000-0000-0000-0000-000000000601', 'tbank_web', '75000000-0000-0000-0000-000000000010', 'web_export', 'completed', '{"parse_strategy": "full"}'),
  ('75000000-0000-0000-0000-000000000602', 'tbank_web', '75000000-0000-0000-0000-000000000010', 'web_export', 'pending', NULL);

INSERT INTO public.money_import_batch_rows (
  batch_id, row_kind, source_row_index, source_line_index, status, transaction_id, line_item_id, payload
)
VALUES
  ('75000000-0000-0000-0000-000000000601', 'transaction', 0, NULL, 'skipped', '75000000-0000-0000-0000-000000000401', NULL, '{"merchant_name": "Bakery"}'),
  ('75000000-0000-0000-0000-000000000601', 'line_item', 0, 1, 'inserted', '75000000-0000-0000-0000-000000000401', '75000000-0000-0000-0000-000000000502', '{"title": "Milk"}'),
  ('75000000-0000-0000-0000-000000000601', 'transaction', 1, NULL, 'inserted', '75000000-0000-0000-0000-000000000402', NULL, '{"merchant_name": "Taxi"}'),
  ('75000000-0000-0000-0000-000000000601', 'line_item', 1, 0, 'inserted', '75000000-0000-0000-0000-000000000402', '75000000-0000-0000-0000-000000000503', '{"title": "Ride"}'),
  ('75000000-0000-0000-0000-000000000601', 'transaction', 2, NULL, 'inserted', '75000000-0000-0000-0000-000000000403', NULL, '{"merchant_name": "Payroll"}'),
  ('75000000-0000-0000-0000-000000000601', 'transaction', 3, NULL, 'error', NULL, NULL, '{"merchant_name": "Broken"}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-rollback@example.com', true);
SELECT set_config('request.jwt.claim.sub', '75000000-0000-0000-0000-000000000001', true);

SELECT is(
  public.money_rollback_import_batch('75000000-0000-0000-0000-000000000601'),
  jsonb_build_object(
    'batch_id', '75000000-0000-0000-0000-000000000601',
    'status', 'rolled_back',
    'deleted_transactions', 2,
    'deleted_line_items', 1
  ),
  'rollback reports the two transactions it created and the one line item it added elsewhere'
);

SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.money_transactions
   WHERE payer_person_id = '75000000-0000-0000-0000-000000000010'),
  ARRAY['75000000-0000-0000-0000-000000000401'::uuid],
  'the transaction that existed before the batch stays, the batch''s own are gone'
);

SELECT is(
  (SELECT array_agg(title ORDER BY title) FROM public.money_line_items
   WHERE transaction_id = '75000000-0000-0000-0000-000000000401'),
  ARRAY['Bread'],
  'the line item the batch added to the existing transaction is gone, the earlier one stays'
);

SELECT is(
  (SELECT status FROM public.money_import_batches WHERE id = '75000000-0000-0000-0000-000000000601'),
  'rolled_back',
  'the batch is marked rolled_back'
);

SELECT ok(
  (SELECT meta ? 'rolled_back_at' AND meta ->> 'parse_strategy' = 'full'
   FROM public.money_import_batches WHERE id = '75000000-0000-0000-0000-000000000601'),
  'the batch meta records when it was rolled back and keeps what it had'
);

SELECT is(
  (SELECT count(*) FROM public.money_import_batch_rows
   WHERE batch_id = '75000000-0000-0000-0000-000000000601' AND payload IS NOT NULL),
  6::bigint,
  'the batch rows and their payloads stay readable'
);

SELECT throws_ok(
  $$ SELECT public.money_rollback_import_batch('75000000-0000-0000-0000-000000000601') $$,
  'P0001',
  'money import batch 75000000-0000-0000-0000-000000000601 is rolled_back, only a completed batch can be rolled back',
  'a batch is rolled back once'
);

SELECT throws_ok(
  $$ SELECT public.money_rollback_import_batch('75000000-0000-0000-0000-000000000602') $$,
  'P0001',
  'money import batch 75000000-0000-0000-0000-000000000602 is pending, only a completed batch can be rolled back',
  'a batch that was never applied is refused'
);

SELECT * FROM finish();
ROLLBACK;
