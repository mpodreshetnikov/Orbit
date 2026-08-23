-- GENERATED FILE — do not edit by hand.
-- Source: supabase/tests/fixtures/money_rule_filter_cases.json
-- Regenerate: node scripts/money/generate-rule-filter-conformance-sql.cjs
--
-- The money rule engine exists twice: in PL/pgSQL here and in TypeScript in
-- supabase/functions/money-categorize/service.ts. Which one runs depends on whether the
-- person has an LLM rule enabled, so enabling one rule must not change how every other
-- rule behaves. This suite and its Deno twin run the same corpus through both.

BEGIN;
SELECT plan(56);

SELECT has_function('public', 'money_evaluate_category_rule_filter', ARRAY['jsonb', 'uuid', 'text', 'jsonb']);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains","value":"latte"}'::jsonb
  ),
  true,
  'contains matches a substring of the line item title'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"  LATTE   GRANDE ","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains","value":"latte grande"}'::jsonb
  ),
  true,
  'contains is case and whitespace insensitive'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains","value":"espresso"}'::jsonb
  ),
  false,
  'contains does not match a different substring'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":null,"amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains","value":"latte"}'::jsonb
  ),
  false,
  'contains never matches an empty field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains","value":""}'::jsonb
  ),
  false,
  'contains never matches an empty needle'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"merchant_name","operator":"not_contains","value":"bakery"}'::jsonb
  ),
  true,
  'not_contains passes when the substring is absent'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"merchant_name","operator":"not_contains","value":"coffee"}'::jsonb
  ),
  false,
  'not_contains fails when the substring is present'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":null,"comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"merchant_name","operator":"not_contains","value":"coffee"}'::jsonb
  ),
  true,
  'not_contains passes on an empty field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"source","operator":"equals","value":"tbank"}'::jsonb
  ),
  true,
  'equals matches the whole text'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"TBank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"source","operator":"equals","value":"tbank"}'::jsonb
  ),
  true,
  'equals ignores case'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"source","operator":"equals","value":"alfa"}'::jsonb
  ),
  false,
  'equals rejects a different value'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":null,"source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"source","operator":"equals","value":"tbank"}'::jsonb
  ),
  false,
  'equals rejects an empty field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"equals","value":"-320"}'::jsonb
  ),
  true,
  'equals compares amounts numerically'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"equals","value":"-100"}'::jsonb
  ),
  false,
  'equals rejects a different amount'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":true,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"is_transfer","operator":"equals","value":"true"}'::jsonb
  ),
  true,
  'equals compares the transfer flag as a boolean'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":true,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"is_transfer","operator":"equals","value":"false"}'::jsonb
  ),
  false,
  'equals rejects the opposite transfer flag'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"starts_with","value":"latte"}'::jsonb
  ),
  true,
  'starts_with matches a prefix'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"starts_with","value":"grande"}'::jsonb
  ),
  false,
  'starts_with rejects a non-prefix substring'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":null,"amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"starts_with","value":"latte"}'::jsonb
  ),
  false,
  'starts_with rejects an empty field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"^Latte"}'::jsonb
  ),
  true,
  'regex matches the raw value'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"^latte"}'::jsonb
  ),
  false,
  'regex is applied to the raw value, not the lowered one'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"^Espresso"}'::jsonb
  ),
  false,
  'regex does not match a different pattern'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":null,"amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"^$"}'::jsonb
  ),
  true,
  'regex on an empty field only matches an empty-tolerant pattern'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"regex","value":"["}'::jsonb
  ),
  false,
  'an uncompilable regex is a non-match, not a failure'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains_any_in_set","values":["espresso","latte"]}'::jsonb
  ),
  true,
  'contains_any_in_set matches when one entry is a substring'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains_any_in_set","values":["espresso","americano"]}'::jsonb
  ),
  false,
  'contains_any_in_set rejects when no entry matches'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":null,"amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains_any_in_set","values":["latte"]}'::jsonb
  ),
  false,
  'contains_any_in_set rejects an empty field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"contains_any_in_set","values":[]}'::jsonb
  ),
  false,
  'contains_any_in_set rejects an empty set'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"mcc","operator":"equals_any_in_set","values":["5411","5812"]}'::jsonb
  ),
  true,
  'equals_any_in_set matches an exact member'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"mcc","operator":"equals_any_in_set","values":["5411","5999"]}'::jsonb
  ),
  false,
  'equals_any_in_set rejects a non-member'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":null,"transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"mcc","operator":"equals_any_in_set","values":["5812"]}'::jsonb
  ),
  false,
  'equals_any_in_set rejects an empty field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"transaction_amount","operator":"equals_any_in_set","values":["-320","-100"]}'::jsonb
  ),
  true,
  'equals_any_in_set compares amounts as numbers'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":true,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"is_transfer","operator":"equals_any_in_set","values":["true"]}'::jsonb
  ),
  true,
  'equals_any_in_set compares the transfer flag as text'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"account_kind","operator":"in_set","values":["debit","credit"]}'::jsonb
  ),
  true,
  'in_set matches an exact member'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"account_kind","operator":"in_set","values":["credit","cash"]}'::jsonb
  ),
  false,
  'in_set rejects a non-member'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":null}}'::jsonb,
    NULL,
    NULL,
    '{"field":"account_kind","operator":"in_set","values":["debit"]}'::jsonb
  ),
  false,
  'in_set rejects an empty field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-120.5},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"in_set","values":["-120.5"]}'::jsonb
  ),
  true,
  'in_set matches a decimal amount'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"range","min":-500,"max":-100}'::jsonb
  ),
  true,
  'range matches inside both bounds'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"range","min":-320,"max":0}'::jsonb
  ),
  true,
  'range matches on the lower bound'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"range","min":-100,"max":0}'::jsonb
  ),
  false,
  'range rejects below the lower bound'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"range","max":0}'::jsonb
  ),
  true,
  'range with only a maximum matches anything below it'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_amount","operator":"range","min":0}'::jsonb
  ),
  false,
  'range with only a minimum rejects anything below it'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"merchant_name","operator":"range","min":-500,"max":0}'::jsonb
  ),
  false,
  'range rejects a non-numeric field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":null,"source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"transaction_comment","operator":"is_empty"}'::jsonb
  ),
  true,
  'is_empty matches a null field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"   ","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"transaction_comment","operator":"is_empty"}'::jsonb
  ),
  true,
  'is_empty matches a whitespace-only field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"transaction_comment","operator":"is_empty"}'::jsonb
  ),
  false,
  'is_empty rejects a filled field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"transaction_comment","operator":"is_not_empty"}'::jsonb
  ),
  true,
  'is_not_empty matches a filled field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":null,"source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"transaction_comment","operator":"is_not_empty"}'::jsonb
  ),
  false,
  'is_not_empty rejects a null field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"  ","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"transaction_comment","operator":"is_not_empty"}'::jsonb
  ),
  false,
  'is_not_empty rejects a whitespace-only field'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    'aa000000-0000-0000-0000-000000000001'::uuid,
    NULL,
    '{"field":"current_category_id","operator":"equals","value":"aa000000-0000-0000-0000-000000000001"}'::jsonb
  ),
  true,
  'current_category_id compares the state category'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"current_category_id","operator":"is_empty"}'::jsonb
  ),
  true,
  'current_category_id is empty when nothing is assigned'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    'food',
    '{"field":"canonical_branch_system_key","operator":"equals","value":"food"}'::jsonb
  ),
  true,
  'canonical_branch_system_key compares the state branch'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"canonical_branch_system_key","operator":"is_empty"}'::jsonb
  ),
  true,
  'canonical_branch_system_key is empty when nothing is assigned'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"not_a_field","operator":"is_not_empty"}'::jsonb
  ),
  false,
  'an unknown field never matches'
);

SELECT is(
  public.money_evaluate_category_rule_filter(
    '{"line_item":{"title":"Latte Grande","amount":-320},"transaction":{"merchant_name":"Coffee Shop","comment":"Morning run","source_comment":"CAFE 12","source":"tbank","source_category_id":"bank-food","source_category_name":"Food","mcc":"5812","transaction_type":"expense","payer_person_id":"bb000000-0000-0000-0000-000000000001","is_transfer":false,"amount":-320},"account":{"source":"tbank","account_kind":"debit"}}'::jsonb,
    NULL,
    NULL,
    '{"field":"line_item_title","operator":"not_an_operator","value":"latte"}'::jsonb
  ),
  false,
  'an unknown operator never matches'
);

SELECT * FROM finish();
ROLLBACK;
