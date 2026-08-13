BEGIN;
SELECT plan(7);

-- Defect: an uncompilable regex in one rule aborted categorisation for the whole batch, because the
-- pattern was handed straight to `~` from inside a single CASE expression and the resulting
-- invalid_regular_expression propagated out of money_run_category_rule_pipeline_internal.

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"^lat"}'::jsonb
  ),
  true,
  'a valid regex still matches'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"["}'::jsonb
  ),
  false,
  'an uncompilable regex evaluates to false instead of raising'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"(unclosed"}'::jsonb
  ),
  false,
  'an unbalanced group evaluates to false instead of raising'
);

INSERT INTO public.persons (id, name, kind)
VALUES ('5a000000-0000-0000-0000-000000000010', 'Regex Rule Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '5a000000-0000-0000-0000-000000000020',
  '5a000000-0000-0000-0000-000000000010',
  'manual',
  'debit',
  'Regex rule account',
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
  '5a000000-0000-0000-0000-000000000030',
  canonical.id,
  canonical.id,
  'custom',
  2,
  'Кофе',
  'Coffee',
  'regex-rule-coffee'
FROM public.money_categories AS canonical
WHERE canonical.system_key = 'food';

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
VALUES (
  '5a000000-0000-0000-0000-000000000040',
  '5a000000-0000-0000-0000-000000000010',
  '5a000000-0000-0000-0000-000000000020',
  'manual',
  '2026-03-05T10:00:00Z',
  -320,
  'RUB',
  'expense',
  'posted',
  'Coffee shop',
  false,
  'regex-rule-hash-1'
);

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  category_id,
  assignment_method,
  category_locked_by_user
)
VALUES (
  '5a000000-0000-0000-0000-000000000050',
  '5a000000-0000-0000-0000-000000000040',
  'Latte',
  -320,
  NULL,
  'import',
  false
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
VALUES
  (
    '5a000000-0000-0000-0000-000000000060',
    '5a000000-0000-0000-0000-000000000010',
    'Broken regex rule',
    true,
    1,
    'direct',
    '5a000000-0000-0000-0000-000000000030',
    'all',
    'all_line_items',
    '[{"field":"line_item_title","operator":"regex","value":"["}]'::jsonb,
    '{}'::jsonb,
    true
  ),
  (
    '5a000000-0000-0000-0000-000000000061',
    '5a000000-0000-0000-0000-000000000010',
    'Latte direct rule',
    true,
    2,
    'direct',
    '5a000000-0000-0000-0000-000000000030',
    'all',
    'all_line_items',
    '[{"field":"line_item_title","operator":"contains","value":"latte"}]'::jsonb,
    '{}'::jsonb,
    true
  );

-- The run must survive the broken rule and let the rule after it do its work. Before the fix this
-- call raised and nothing in the batch was categorised.
SELECT is(
  public.money_preview_category_rule_pipeline(
    '5a000000-0000-0000-0000-000000000050'::uuid,
    '5a000000-0000-0000-0000-000000000010'::uuid,
    NULL
  )->>'final_category_id',
  '5a000000-0000-0000-0000-000000000030',
  'a rule with a broken pattern does not stop the rules after it'
);

SELECT is(
  (
    SELECT step.value->>'matched'
    FROM jsonb_array_elements(
      public.money_preview_category_rule_pipeline(
        '5a000000-0000-0000-0000-000000000050'::uuid,
        '5a000000-0000-0000-0000-000000000010'::uuid,
        NULL
      )->'steps'
    ) AS step(value)
    WHERE step.value->>'rule_id' = '5a000000-0000-0000-0000-000000000060'
  ),
  'false',
  'the rule carrying the broken pattern is reported as not matched'
);

-- Defect: the rule-kind CASE had no ELSE branch, so the day a fifth value is added to
-- money_rule_kind without updating this function, plpgsql raises CASE_NOT_FOUND and the whole run
-- fails instead of the single rule.
--
-- This is asserted against the function source rather than by adding an enum value, because pgTAP
-- runs inside one transaction and a value added by ALTER TYPE cannot be relied on to be usable in
-- the same transaction. The assertion still catches the regression it exists for: removing the
-- ELSE branch.
SELECT ok(
  (
    SELECT prosrc LIKE '%Unsupported rule kind%'
    FROM pg_proc
    WHERE oid = 'public.money_run_category_rule_pipeline_internal(uuid, uuid, uuid[], boolean, boolean, text)'::regprocedure
  ),
  'the rule-kind CASE has a default branch for an unknown rule kind'
);

SELECT ok(
  (
    SELECT prosrc LIKE '%invalid_regular_expression%'
    FROM pg_proc
    WHERE oid = 'public.money_evaluate_category_rule_filter(jsonb, uuid, text, jsonb)'::regprocedure
  ),
  'the regex operator catches an uncompilable pattern'
);

SELECT * FROM finish();
ROLLBACK;
