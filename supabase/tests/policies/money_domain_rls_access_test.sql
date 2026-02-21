BEGIN;
SELECT plan(12);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('12121212-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'money-rls@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('12121212-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'money-rls@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Money RLS Person', 'human');

INSERT INTO public.money_accounts (id, owner_person_id, source, account_kind, account_label, currency)
VALUES (
  '56565656-cccc-cccc-cccc-cccccccccccc',
  '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'manual',
  'debit',
  'Money RLS Account',
  'RUB'
);

INSERT INTO public.money_cards (id, account_id, last4, card_label)
VALUES (
  '78787878-dddd-dddd-dddd-dddddddddddd',
  '56565656-cccc-cccc-cccc-cccccccccccc',
  '1234',
  'Main Card'
);

INSERT INTO public.money_categories (id, depth, name_ru, name_en, slug)
VALUES (
  '90909090-eeee-eeee-eeee-eeeeeeeeeeee',
  1,
  'Еда',
  'Food',
  'money-rls-food'
);

INSERT INTO public.money_import_sessions (
  id,
  token_hash,
  source,
  payer_person_id,
  created_by_auth_user_id,
  expires_at
)
VALUES (
  'abababab-1111-1111-1111-111111111111',
  'token-hash-1',
  'tbank',
  '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '12121212-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  now() + interval '1 day'
);

INSERT INTO public.money_import_batches (
  id,
  source,
  payer_person_id,
  session_id,
  status
)
VALUES (
  'cdcdcdcd-2222-2222-2222-222222222222',
  'tbank',
  '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'abababab-1111-1111-1111-111111111111',
  'running'
);

INSERT INTO public.money_import_batch_rows (
  batch_id,
  row_kind,
  source_row_index,
  status,
  payload
)
VALUES (
  'cdcdcdcd-2222-2222-2222-222222222222',
  'transaction',
  0,
  'inserted',
  '{"source":"seed"}'::jsonb
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
  dedupe_hash
)
VALUES (
  'efefefef-3333-3333-3333-333333333333',
  '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '56565656-cccc-cccc-cccc-cccccccccccc',
  'manual',
  now(),
  250,
  'RUB',
  'expense',
  'posted',
  'Money RLS Merchant',
  'money-rls-hash'
);

INSERT INTO public.money_line_items (transaction_id, title, amount, category_id)
VALUES (
  'efefefef-3333-3333-3333-333333333333',
  'Dinner',
  250,
  '90909090-eeee-eeee-eeee-eeeeeeeeeeee'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-rls@example.com', true);

SELECT is(
  (SELECT count(*) FROM public.money_cards WHERE id = '78787878-dddd-dddd-dddd-dddddddddddd'),
  1::bigint,
  'allowlisted user can read target money_cards row'
);
SELECT is(
  (SELECT count(*) FROM public.money_categories WHERE id = '90909090-eeee-eeee-eeee-eeeeeeeeeeee'),
  1::bigint,
  'allowlisted user can read target money_categories row'
);
SELECT is(
  (SELECT count(*) FROM public.money_import_sessions WHERE id = 'abababab-1111-1111-1111-111111111111'),
  1::bigint,
  'allowlisted user can read target money_import_sessions row'
);
SELECT is(
  (SELECT count(*) FROM public.money_import_batches WHERE id = 'cdcdcdcd-2222-2222-2222-222222222222'),
  1::bigint,
  'allowlisted user can read target money_import_batches row'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.money_import_batch_rows
    WHERE batch_id = 'cdcdcdcd-2222-2222-2222-222222222222'
      AND source_row_index = 0
  ),
  1::bigint,
  'allowlisted user can read target money_import_batch_rows row'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.money_line_items
    WHERE transaction_id = 'efefefef-3333-3333-3333-333333333333'
      AND title = 'Dinner'
  ),
  1::bigint,
  'allowlisted user can read target money_line_items row'
);

SELECT set_config('request.jwt.claim.email', 'money-rls-deny@example.com', true);

SELECT is(
  (SELECT count(*) FROM public.money_cards WHERE id = '78787878-dddd-dddd-dddd-dddddddddddd'),
  0::bigint,
  'non-allowlisted user cannot read target money_cards row'
);
SELECT is(
  (SELECT count(*) FROM public.money_categories WHERE id = '90909090-eeee-eeee-eeee-eeeeeeeeeeee'),
  0::bigint,
  'non-allowlisted user cannot read target money_categories row'
);
SELECT is(
  (SELECT count(*) FROM public.money_import_sessions WHERE id = 'abababab-1111-1111-1111-111111111111'),
  0::bigint,
  'non-allowlisted user cannot read target money_import_sessions row'
);
SELECT is(
  (SELECT count(*) FROM public.money_import_batches WHERE id = 'cdcdcdcd-2222-2222-2222-222222222222'),
  0::bigint,
  'non-allowlisted user cannot read target money_import_batches row'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.money_import_batch_rows
    WHERE batch_id = 'cdcdcdcd-2222-2222-2222-222222222222'
      AND source_row_index = 0
  ),
  0::bigint,
  'non-allowlisted user cannot read target money_import_batch_rows row'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.money_line_items
    WHERE transaction_id = 'efefefef-3333-3333-3333-333333333333'
      AND title = 'Dinner'
  ),
  0::bigint,
  'non-allowlisted user cannot read target money_line_items row'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
