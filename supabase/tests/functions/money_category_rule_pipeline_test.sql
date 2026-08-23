BEGIN;
SELECT plan(29);

SELECT has_function('public', 'money_preview_category_rule_pipeline', ARRAY['uuid', 'uuid', 'uuid[]']);
SELECT has_function('public', 'money_apply_category_rule_pipeline', ARRAY['uuid[]', 'uuid', 'boolean', 'text']);
SELECT has_function('public', 'money_apply_category_rule_pipeline_for_transaction', ARRAY['uuid', 'uuid', 'boolean']);
SELECT has_function('public', 'money_apply_category_rule_pipeline_for_date_range', ARRAY['uuid', 'date', 'date', 'boolean']);
SELECT has_function('public', 'money_get_category_rule_debug', ARRAY['uuid', 'integer']);

SELECT function_returns(
  'public',
  'money_preview_category_rule_pipeline',
  ARRAY['uuid', 'uuid', 'uuid[]'],
  'jsonb'
);

SELECT function_returns(
  'public',
  'money_apply_category_rule_pipeline',
  ARRAY['uuid[]', 'uuid', 'boolean', 'text'],
  'jsonb'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'public.money_rule_kind'::regtype
      AND enumlabel = 'source_category_map'
  ),
  'money_rule_kind no longer includes source_category_map'
);

INSERT INTO public.persons (id, name, kind)
VALUES
  ('51111111-1111-1111-1111-111111111111', 'Rule Person', 'human'),
  ('52222222-2222-2222-2222-222222222222', 'Other Rule Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES
  ('61111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', 'tbank', 'debit', 'Rule Main', 'RUB'),
  ('62222222-2222-2222-2222-222222222222', '52222222-2222-2222-2222-222222222222', 'tbank', 'debit', 'Other Main', 'RUB');

INSERT INTO public.money_categories (
  id,
  parent_id,
  canonical_category_id,
  category_kind,
  sort_order,
  depth,
  name_ru,
  name_en,
  slug
)
SELECT
  '71111111-1111-1111-1111-111111111111',
  NULL,
  food.id,
  'custom',
  100,
  1,
  'Кофе',
  'Coffee',
  'coffee'
FROM public.money_categories AS food
WHERE food.system_key = 'food';

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
  mcc,
  source_category_id,
  source_category_name
)
VALUES
  ('81111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111111', 'tbank', '2026-02-01T10:00:00Z', 320, 'RUB', 'expense', 'posted', 'Coffee Shop', '5812', 'bank-food', 'Food'),
  ('82222222-2222-2222-2222-222222222222', '51111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111111', 'tbank', '2026-02-02T10:00:00Z', 120, 'RUB', 'expense', 'posted', 'Coffee Shop', NULL, NULL, NULL),
  ('83333333-3333-3333-3333-333333333333', '51111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111111', 'tbank', '2026-02-03T10:00:00Z', 500, 'RUB', 'expense', 'posted', 'Fashion Mall', NULL, 'bank-shopping', 'Shopping'),
  ('84444444-4444-4444-4444-444444444444', '51111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111111', 'tbank', '2026-02-04T10:00:00Z', 220, 'RUB', 'expense', 'posted', 'Coffee Shop', NULL, NULL, NULL),
  ('85555555-5555-5555-5555-555555555555', '51111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111111', 'tbank', '2026-02-05T10:00:00Z', 140, 'RUB', 'expense', 'posted', 'Wellness Store', NULL, NULL, NULL),
  ('86666666-6666-6666-6666-666666666666', '51111111-1111-1111-1111-111111111111', '61111111-1111-1111-1111-111111111111', 'tbank', '2026-02-06T10:00:00Z', 140, 'RUB', 'expense', 'posted', 'Wellness Store', NULL, NULL, NULL),
  ('87777777-7777-7777-7777-777777777777', '52222222-2222-2222-2222-222222222222', '62222222-2222-2222-2222-222222222222', 'tbank', '2026-02-07T10:00:00Z', 320, 'RUB', 'expense', 'posted', 'Coffee Shop', NULL, NULL, NULL);

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  category_id,
  assignment_method,
  category_locked_by_user
)
VALUES
  ('91111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111', 'Latte', 320, NULL, 'import', false),
  ('92222222-2222-2222-2222-222222222222', '82222222-2222-2222-2222-222222222222', 'Coffee beans', 120, '71111111-1111-1111-1111-111111111111', 'manual', true),
  ('93333333-3333-3333-3333-333333333333', '83333333-3333-3333-3333-333333333333', 'Jacket', 500, NULL, 'import', false),
  ('94444444-4444-4444-4444-444444444444', '84444444-4444-4444-4444-444444444444', 'Croissant', 220, NULL, 'import', false),
  ('95555555-5555-5555-5555-555555555555', '85555555-5555-5555-5555-555555555555', 'Protein Bar', 140, '71111111-1111-1111-1111-111111111111', 'manual', true),
  ('96666666-6666-6666-6666-666666666666', '86666666-6666-6666-6666-666666666666', 'Protein Bar', 140, NULL, 'import', false),
  ('97777777-7777-7777-7777-777777777777', '87777777-7777-7777-7777-777777777777', 'Latte', 320, NULL, 'import', false);

INSERT INTO public.money_category_rules (
  id,
  person_id,
  name,
  enabled,
  sort_order,
  rule_kind,
  target_category_id,
  match_mode,
  scope_filter,
  filters,
  config,
  stop_processing
)
VALUES
  (
    'a1111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    'Latte direct',
    true,
    1,
    'direct',
    '71111111-1111-1111-1111-111111111111',
    'all',
    'all_line_items',
    '[{"field":"line_item_title","operator":"contains","value":"latte"}]'::jsonb,
    '{}'::jsonb,
    true
  ),
  (
    'a2222222-2222-2222-2222-222222222222',
    '51111111-1111-1111-1111-111111111111',
    'MCC map',
    true,
    2,
    'mcc_map',
    NULL,
    'all',
    'uncategorized_only',
    '[]'::jsonb,
    '{}'::jsonb,
    true
  ),
  (
    'a6666666-6666-6666-6666-666666666666',
    '51111111-1111-1111-1111-111111111111',
    'Line-item title contains any set',
    true,
    3,
    'direct',
    '71111111-1111-1111-1111-111111111111',
    'all',
    'all_line_items',
    '[{"field":"line_item_title","operator":"contains_any_in_set","values":["lat","tea"]}]'::jsonb,
    '{}'::jsonb,
    false
  ),
  (
    'a7777777-7777-7777-7777-777777777777',
    '51111111-1111-1111-1111-111111111111',
    'Line-item title equals any set',
    true,
    4,
    'direct',
    '71111111-1111-1111-1111-111111111111',
    'all',
    'all_line_items',
    '[{"field":"line_item_title","operator":"equals_any_in_set","values":["lat","tea"]}]'::jsonb,
    '{}'::jsonb,
    false
  );

SELECT is(
  public.money_preview_category_rule_pipeline(
    '91111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    ARRAY['a6666666-6666-6666-6666-666666666666'::uuid]
  )->>'final_category_id',
  '71111111-1111-1111-1111-111111111111',
  'contains-any-in-set matches partial line-item text'
);

SELECT is(
  public.money_preview_category_rule_pipeline(
    '91111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    ARRAY['a7777777-7777-7777-7777-777777777777'::uuid]
  )->>'final_category_id',
  NULL,
  'equals-any-in-set requires an exact line-item match'
);

SELECT is(
  public.money_preview_category_rule_pipeline(
    '91111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    NULL
  )->>'final_category_id',
  '71111111-1111-1111-1111-111111111111',
  'preview resolves the direct rule target category'
);

SELECT is(
  public.money_preview_category_rule_pipeline(
    '91111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    NULL
  )->>'line_item_title',
  'Latte',
  'preview report includes the line item title'
);

SELECT is(
  public.money_preview_category_rule_pipeline(
    '91111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    NULL
  )->>'merchant_name',
  'Coffee Shop',
  'preview report includes the merchant name'
);

SELECT is(
  (public.money_preview_category_rule_pipeline(
    '91111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    NULL
  )->>'saved')::boolean,
  false,
  'preview does not persist category changes'
);

SELECT lives_ok(
  $$SELECT public.money_apply_category_rule_pipeline(
      ARRAY['91111111-1111-1111-1111-111111111111'::uuid],
      '51111111-1111-1111-1111-111111111111'::uuid,
      false,
      'manual_replay'
    )$$,
  'apply pipeline succeeds for a direct rule'
);

SELECT is(
  (SELECT category_id::text FROM public.money_line_items WHERE id = '91111111-1111-1111-1111-111111111111'),
  '71111111-1111-1111-1111-111111111111',
  'apply pipeline persists the direct rule category'
);

SELECT is(
  (SELECT assignment_method::text FROM public.money_line_items WHERE id = '91111111-1111-1111-1111-111111111111'),
  'rule',
  'apply pipeline marks the line item as rule-assigned'
);

SELECT ok(
  jsonb_array_length(public.money_get_category_rule_debug('91111111-1111-1111-1111-111111111111', 5)) >= 1,
  'debug history is persisted for applied runs'
);

UPDATE public.money_line_items
SET
  category_id = (SELECT id FROM public.money_categories WHERE system_key = 'transport'),
  assignment_method = 'manual',
  category_locked_by_user = true
WHERE id = '91111111-1111-1111-1111-111111111111';

SELECT is(
  public.money_apply_category_rule_pipeline(
    ARRAY['91111111-1111-1111-1111-111111111111'::uuid],
    '51111111-1111-1111-1111-111111111111'::uuid,
    false,
    'manual_replay'
  )->'runs'->0->>'final_category_id',
  (SELECT id::text FROM public.money_categories WHERE system_key = 'transport'),
  'manual lock prevents overwrite when force is false'
);

SELECT is(
  public.money_apply_category_rule_pipeline(
    ARRAY['91111111-1111-1111-1111-111111111111'::uuid],
    '51111111-1111-1111-1111-111111111111'::uuid,
    true,
    'manual_replay'
  )->'runs'->0->>'final_category_id',
  '71111111-1111-1111-1111-111111111111',
  'force replay overwrites a locked manual category'
);

SELECT is(
  public.money_apply_category_rule_pipeline_for_transaction(
    '83333333-3333-3333-3333-333333333333'::uuid,
    '51111111-1111-1111-1111-111111111111'::uuid,
    false
  )->'runs'->0->>'final_category_id',
  NULL,
  'transaction replay does not apply removed source-category mappings'
);

SELECT is(
  (public.money_apply_category_rule_pipeline_for_date_range(
    '51111111-1111-1111-1111-111111111111'::uuid,
    '2026-02-01'::date,
    '2026-02-28'::date,
    false
  )->>'count')::int,
  6,
  'date-range replay processes only the selected person line items'
);

SELECT is(
  (SELECT category_id FROM public.money_line_items WHERE id = '97777777-7777-7777-7777-777777777777'),
  NULL::uuid,
  'date-range replay for one person does not affect another person line item'
);

DELETE FROM public.money_category_rules
WHERE id = 'a1111111-1111-1111-1111-111111111111';

SELECT is(
  (
    SELECT step.value->>'rule_name'
    FROM jsonb_array_elements(
      public.money_get_category_rule_debug('91111111-1111-1111-1111-111111111111', 5)
    ) WITH ORDINALITY AS run(value, run_ordinality)
    CROSS JOIN LATERAL jsonb_array_elements(run.value->'steps')
      WITH ORDINALITY AS step(value, step_ordinality)
    ORDER BY run.run_ordinality, step.step_ordinality
    LIMIT 1
  ),
  'Latte direct',
  'debug history keeps the deleted rule name snapshot'
);

SELECT is(
  (
    SELECT step.value->>'rule_kind'
    FROM jsonb_array_elements(
      public.money_get_category_rule_debug('91111111-1111-1111-1111-111111111111', 5)
    ) WITH ORDINALITY AS run(value, run_ordinality)
    CROSS JOIN LATERAL jsonb_array_elements(run.value->'steps')
      WITH ORDINALITY AS step(value, step_ordinality)
    ORDER BY run.run_ordinality, step.step_ordinality
    LIMIT 1
  ),
  'direct',
  'debug history keeps the deleted rule kind snapshot'
);

-- Robustness: a rule pattern the user typed must not be able to abort the whole run.
SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item": {"title": "Latte"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"["}'::jsonb
  ),
  false,
  'an uncompilable regex evaluates to false instead of raising'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item": {"title": "Latte"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"^lat"}'::jsonb
  ),
  true,
  'a valid regex still matches after the guard'
);

INSERT INTO public.money_category_rules (
  id,
  person_id,
  name,
  enabled,
  sort_order,
  rule_kind,
  target_category_id,
  match_mode,
  scope_filter,
  filters,
  config,
  stop_processing
)
VALUES (
  'a9999999-9999-9999-9999-999999999999',
  '51111111-1111-1111-1111-111111111111',
  'Broken pattern',
  true,
  0,
  'direct',
  '71111111-1111-1111-1111-111111111111',
  'all',
  'all_line_items',
  '[{"field":"line_item_title","operator":"regex","value":"["}]'::jsonb,
  '{}'::jsonb,
  false
);

SELECT is(
  (
    SELECT public.money_preview_category_rule_pipeline(
      '96666666-6666-6666-6666-666666666666',
      '51111111-1111-1111-1111-111111111111',
      NULL
    ) IS NOT NULL
  ),
  true,
  'a rule carrying a broken pattern does not abort the pipeline run'
);

-- The CASE over money_rule_kind needs an ELSE branch, or adding a value to the enum and
-- forgetting this function raises CASE_NOT_FOUND and takes down the whole run rather than
-- the one rule. The branch cannot be exercised directly: ALTER TYPE ... ADD VALUE inside a
-- transaction cannot be used in that same transaction, and pgTAP tests are one transaction.
SELECT ok(
  pg_get_functiondef('public.money_run_category_rule_pipeline_internal(uuid, uuid, uuid[], boolean, boolean, text)'::regprocedure)
    LIKE '%Unsupported rule kind%',
  'the rule kind CASE has a default branch for values it does not know'
);

SELECT * FROM finish();
ROLLBACK;
