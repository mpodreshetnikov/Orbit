BEGIN;
SELECT plan(30);

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
  '90909090-eeee-eeee-eeee-eeeeeeeeeeee',
  NULL,
  canonical.id,
  'custom',
  1,
  'Еда',
  'Food',
  'money-rls-food'
FROM public.money_categories AS canonical
WHERE canonical.system_key = 'food';

INSERT INTO public.money_transaction_brands (
  id,
  slug,
  name
)
VALUES (
  '91919191-eeee-eeee-eeee-eeeeeeeeeeee',
  'money-rls-brand',
  'Money RLS Brand'
);

INSERT INTO public.money_transaction_brand_aliases (
  id,
  brand_id,
  source,
  source_key,
  source_name
)
VALUES (
  '92929292-eeee-eeee-eeee-eeeeeeeeeeee',
  '91919191-eeee-eeee-eeee-eeeeeeeeeeee',
  'tbank',
  'money-rls-brand',
  'Money RLS Brand'
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

INSERT INTO public.money_import_batch_brand_resolutions (
  id,
  batch_id,
  source,
  source_key,
  source_name,
  suggested_brand_id,
  suggested_confidence,
  suggested_reason,
  selected_action,
  selected_brand_id
)
VALUES (
  'dededede-4444-4444-4444-444444444444',
  'cdcdcdcd-2222-2222-2222-222222222222',
  'tbank',
  'money-rls-brand',
  'Money RLS Brand',
  '91919191-eeee-eeee-eeee-eeeeeeeeeeee',
  100,
  'existing_alias',
  'match_existing',
  '91919191-eeee-eeee-eeee-eeeeeeeeeeee'
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

INSERT INTO public.money_category_rules (
  id,
  person_id,
  name,
  enabled,
  sort_order,
  rule_kind,
  target_category_id
)
VALUES (
  'a0a0a0a0-1111-1111-1111-111111111111',
  '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Money RLS Rule',
  true,
  1,
  'direct',
  '90909090-eeee-eeee-eeee-eeeeeeeeeeee'
);

INSERT INTO public.money_category_rule_runs (
  id,
  triggered_by_user_id,
  person_id,
  trigger_source,
  line_item_id,
  transaction_id,
  final_category_id,
  saved
)
VALUES (
  'b0b0b0b0-2222-2222-2222-222222222222',
  '12121212-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'manual_replay',
  (SELECT id FROM public.money_line_items WHERE transaction_id = 'efefefef-3333-3333-3333-333333333333' LIMIT 1),
  'efefefef-3333-3333-3333-333333333333',
  '90909090-eeee-eeee-eeee-eeeeeeeeeeee',
  true
);

INSERT INTO public.money_category_rule_run_steps (
  id,
  rule_run_id,
  rule_id,
  sort_order,
  matched,
  changed_category,
  next_category_id,
  decision_reason
)
VALUES (
  'c0c0c0c0-3333-3333-3333-333333333333',
  'b0b0b0b0-2222-2222-2222-222222222222',
  'a0a0a0a0-1111-1111-1111-111111111111',
  1,
  true,
  true,
  '90909090-eeee-eeee-eeee-eeeeeeeeeeee',
  'Matched'
);

INSERT INTO public.money_mcc_canonical_category_map (
  mcc,
  canonical_system_key,
  canonical_category_id,
  description
)
VALUES (
  'money-rls-mcc',
  'food',
  '90909090-eeee-eeee-eeee-eeeeeeeeeeee',
  'Cafe'
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
  (SELECT count(*) FROM public.money_transaction_brands WHERE id = '91919191-eeee-eeee-eeee-eeeeeeeeeeee'),
  1::bigint,
  'allowlisted user can read target money_transaction_brands row'
);
SELECT is(
  (SELECT count(*) FROM public.money_transaction_brand_aliases WHERE id = '92929292-eeee-eeee-eeee-eeeeeeeeeeee'),
  1::bigint,
  'allowlisted user can read target money_transaction_brand_aliases row'
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
    FROM public.money_import_batch_brand_resolutions
    WHERE id = 'dededede-4444-4444-4444-444444444444'
  ),
  1::bigint,
  'allowlisted user can read target money_import_batch_brand_resolutions row'
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
SELECT is(
  (SELECT count(*) FROM public.money_category_rules WHERE id = 'a0a0a0a0-1111-1111-1111-111111111111'),
  1::bigint,
  'allowlisted user can read target money_category_rules row'
);
SELECT is(
  (SELECT count(*) FROM public.money_category_rule_runs WHERE id = 'b0b0b0b0-2222-2222-2222-222222222222'),
  1::bigint,
  'allowlisted user can read target money_category_rule_runs row'
);
SELECT is(
  (SELECT count(*) FROM public.money_category_rule_run_steps WHERE id = 'c0c0c0c0-3333-3333-3333-333333333333'),
  1::bigint,
  'allowlisted user can read target money_category_rule_run_steps row'
);
SELECT is(
  (SELECT count(*) FROM public.money_mcc_canonical_category_map WHERE mcc = 'money-rls-mcc'),
  1::bigint,
  'allowlisted user can read target money_mcc_canonical_category_map row'
);
SELECT ok(
  jsonb_array_length(
    public.money_get_category_rule_debug(
      (SELECT id FROM public.money_line_items WHERE transaction_id = 'efefefef-3333-3333-3333-333333333333' LIMIT 1),
      5
    )
  ) >= 1,
  'allowlisted user can call money_get_category_rule_debug'
);

SELECT is(
  public.money_preview_category_rule_pipeline(
    (SELECT id FROM public.money_line_items WHERE transaction_id = 'efefefef-3333-3333-3333-333333333333' LIMIT 1),
    '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    NULL
  )->>'person_id',
  '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'allowlisted user can call money_preview_category_rule_pipeline'
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
  (SELECT count(*) FROM public.money_transaction_brands WHERE id = '91919191-eeee-eeee-eeee-eeeeeeeeeeee'),
  0::bigint,
  'non-allowlisted user cannot read target money_transaction_brands row'
);
SELECT is(
  (SELECT count(*) FROM public.money_transaction_brand_aliases WHERE id = '92929292-eeee-eeee-eeee-eeeeeeeeeeee'),
  0::bigint,
  'non-allowlisted user cannot read target money_transaction_brand_aliases row'
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
    FROM public.money_import_batch_brand_resolutions
    WHERE id = 'dededede-4444-4444-4444-444444444444'
  ),
  0::bigint,
  'non-allowlisted user cannot read target money_import_batch_brand_resolutions row'
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
SELECT is(
  (SELECT count(*) FROM public.money_category_rules WHERE id = 'a0a0a0a0-1111-1111-1111-111111111111'),
  0::bigint,
  'non-allowlisted user cannot read target money_category_rules row'
);
SELECT is(
  (SELECT count(*) FROM public.money_category_rule_runs WHERE id = 'b0b0b0b0-2222-2222-2222-222222222222'),
  0::bigint,
  'non-allowlisted user cannot read target money_category_rule_runs row'
);
SELECT is(
  (SELECT count(*) FROM public.money_category_rule_run_steps WHERE id = 'c0c0c0c0-3333-3333-3333-333333333333'),
  0::bigint,
  'non-allowlisted user cannot read target money_category_rule_run_steps row'
);
SELECT is(
  (SELECT count(*) FROM public.money_mcc_canonical_category_map WHERE mcc = 'money-rls-mcc'),
  0::bigint,
  'non-allowlisted user cannot read target money_mcc_canonical_category_map row'
);
SELECT throws_ok(
  $$
    SELECT public.money_get_category_rule_debug(
      (SELECT id FROM public.money_line_items WHERE transaction_id = 'efefefef-3333-3333-3333-333333333333' LIMIT 1),
      5
    )
  $$,
  'Not authenticated',
  'non-allowlisted user cannot call money_get_category_rule_debug'
);

SELECT throws_ok(
  $$
    SELECT public.money_preview_category_rule_pipeline(
      (SELECT id FROM public.money_line_items WHERE transaction_id = 'efefefef-3333-3333-3333-333333333333' LIMIT 1),
      '34343434-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      NULL
    )
  $$,
  'Not authenticated',
  'non-allowlisted user cannot call money_preview_category_rule_pipeline'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
