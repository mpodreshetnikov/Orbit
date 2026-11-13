BEGIN;
SELECT plan(14);

-- JS twin: supabase/functions/money-categorize/rule_filter_operators_test.ts
-- Shared cases for operator coverage + regex parity (raw, case-sensitive ~).

CREATE TEMP TABLE filter_ctx AS
SELECT jsonb_build_object(
  'line_item', jsonb_build_object(
    'title', 'Flat White Latte',
    'amount', 450
  ),
  'transaction', jsonb_build_object(
    'merchant_name', 'Coffee House',
    'comment', NULL,
    'source_comment', NULL,
    'source', 'tbank',
    'source_category_id', NULL,
    'source_category_name', NULL,
    'mcc', '5814',
    'transaction_type', 'expense',
    'payer_person_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'is_transfer', false,
    'amount', 450
  ),
  'account', jsonb_build_object(
    'source', 'tbank',
    'account_kind', 'debit'
  )
) AS ctx;

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"contains","value":"coffee"}'::jsonb
  ),
  'contains matches lowercased merchant'
);

SELECT ok(
  NOT public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"contains","value":"tea"}'::jsonb
  ),
  'contains rejects non-match'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"not_contains","value":"tea"}'::jsonb
  ),
  'not_contains when absent'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"equals","value":"Coffee House"}'::jsonb
  ),
  'equals is case-insensitive after normalize'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"starts_with","value":"coffee"}'::jsonb
  ),
  'starts_with matches prefix'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"line_item_title","operator":"regex","value":"Flat\\s+White"}'::jsonb
  ),
  'regex matches raw title (POSIX ~)'
);

SELECT ok(
  NOT public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"line_item_title","operator":"regex","value":"flat"}'::jsonb
  ),
  'regex is case-sensitive on raw value (parity with JS RegExp)'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"contains_any_in_set","values":["tea","coffee"]}'::jsonb
  ),
  'contains_any_in_set'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"equals_any_in_set","values":["coffee house","market"]}'::jsonb
  ),
  'equals_any_in_set'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"in_set","values":["coffee house"]}'::jsonb
  ),
  'in_set'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"line_item_amount","operator":"range","min":400,"max":500}'::jsonb
  ),
  'range inclusive'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"transaction_comment","operator":"is_empty"}'::jsonb
  ),
  'is_empty'
);

SELECT ok(
  public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"line_item_title","operator":"is_not_empty"}'::jsonb
  ),
  'is_not_empty'
);

SELECT ok(
  NOT public.money_evaluate_category_rule_filter(
    (SELECT ctx FROM filter_ctx), NULL, NULL,
    '{"field":"merchant_name","operator":"nope","value":"coffee"}'::jsonb
  ),
  'unknown operator is false'
);

SELECT * FROM finish();
ROLLBACK;
