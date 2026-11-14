BEGIN;
SELECT plan(8);

SELECT has_function(
  'public',
  'money_get_category_rule_context',
  ARRAY['uuid', 'uuid']
);

SELECT function_returns(
  'public',
  'money_get_category_rule_context',
  ARRAY['uuid', 'uuid'],
  'jsonb'
);

INSERT INTO public.persons (id, name, kind)
VALUES ('b1111111-1111-1111-1111-111111111111', 'Context Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  'b2111111-1111-1111-1111-111111111111',
  'b1111111-1111-1111-1111-111111111111',
  'tbank',
  'debit',
  'Context Main',
  'RUB'
);

INSERT INTO public.money_cards (id, account_id, last4, card_label)
VALUES (
  'b3111111-1111-1111-1111-111111111111',
  'b2111111-1111-1111-1111-111111111111',
  '4242',
  'Black'
);

INSERT INTO public.money_transaction_brands (id, slug, name)
VALUES (
  'b4111111-1111-1111-1111-111111111111',
  'context-cafe',
  'Context Cafe'
);

INSERT INTO public.money_transactions (
  id,
  payer_person_id,
  account_id,
  card_id,
  brand_id,
  source,
  posted_at,
  amount,
  currency,
  transaction_type,
  status,
  merchant_name,
  mcc,
  raw_payload
)
VALUES (
  'b5111111-1111-1111-1111-111111111111',
  'b1111111-1111-1111-1111-111111111111',
  'b2111111-1111-1111-1111-111111111111',
  'b3111111-1111-1111-1111-111111111111',
  'b4111111-1111-1111-1111-111111111111',
  'tbank',
  '2026-03-10T10:00:00Z',
  -450,
  'RUB',
  'expense',
  'posted',
  'Context Cafe',
  '5814',
  '{"operation":{"id":"op-ctx-1","note":"parent"}}'::jsonb
);

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  quantity,
  unit,
  category_id,
  assignment_method,
  category_locked_by_user
)
VALUES
  (
    'b6111111-1111-1111-1111-111111111111',
    'b5111111-1111-1111-1111-111111111111',
    'Latte',
    -220,
    1,
    'pcs',
    (SELECT id FROM public.money_categories WHERE system_key = 'food'),
    'import',
    false
  ),
  (
    'b6222222-2222-2222-2222-222222222222',
    'b5111111-1111-1111-1111-111111111111',
    'Croissant',
    -130,
    1,
    'pcs',
    NULL,
    'import',
    false
  ),
  (
    'b6333333-3333-3333-3333-333333333333',
    'b5111111-1111-1111-1111-111111111111',
    'Water',
    -100,
    1,
    'pcs',
    NULL,
    'import',
    false
  );

SELECT is(
  public.money_get_category_rule_context(
    'b6111111-1111-1111-1111-111111111111',
    'b1111111-1111-1111-1111-111111111111'
  )->'card'->>'last4',
  '4242',
  'context includes card last4'
);

SELECT is(
  public.money_get_category_rule_context(
    'b6111111-1111-1111-1111-111111111111',
    'b1111111-1111-1111-1111-111111111111'
  )->'account'->>'account_label',
  'Context Main',
  'context includes account_label'
);

SELECT is(
  public.money_get_category_rule_context(
    'b6111111-1111-1111-1111-111111111111',
    'b1111111-1111-1111-1111-111111111111'
  )->'brand'->>'name',
  'Context Cafe',
  'context includes brand name'
);

SELECT is(
  public.money_get_category_rule_context(
    'b6111111-1111-1111-1111-111111111111',
    'b1111111-1111-1111-1111-111111111111'
  )->'current_category'->>'name_en',
  'Food',
  'context includes current category name'
);

SELECT is(
  (
    SELECT jsonb_agg(value->>'title' ORDER BY value->>'title')
    FROM jsonb_array_elements(
      public.money_get_category_rule_context(
        'b6111111-1111-1111-1111-111111111111',
        'b1111111-1111-1111-1111-111111111111'
      )->'receipt_sibling_items'
    ) AS value
  ),
  '["Croissant", "Water"]'::jsonb,
  'multi-line context lists sibling receipt items excluding the target'
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
VALUES (
  'b7111111-1111-1111-1111-111111111111',
  'b1111111-1111-1111-1111-111111111111',
  'b2111111-1111-1111-1111-111111111111',
  'tbank',
  '2026-03-11T10:00:00Z',
  -90,
  'RUB',
  'expense',
  'posted',
  'Solo Shop'
);

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  assignment_method,
  category_locked_by_user
)
VALUES (
  'b8111111-1111-1111-1111-111111111111',
  'b7111111-1111-1111-1111-111111111111',
  'Solo item',
  -90,
  'import',
  false
);

SELECT is(
  public.money_get_category_rule_context(
    'b8111111-1111-1111-1111-111111111111',
    'b1111111-1111-1111-1111-111111111111'
  )->'receipt_sibling_items',
  '[]'::jsonb,
  'single-line context returns empty receipt_sibling_items'
);

SELECT * FROM finish();
ROLLBACK;
