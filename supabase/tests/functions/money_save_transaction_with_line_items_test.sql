BEGIN;
SELECT plan(9);

SELECT has_function('public', 'money_save_transaction_with_line_items', ARRAY['uuid', 'jsonb', 'jsonb']);

INSERT INTO public.persons (id, name, kind)
VALUES ('7f000000-0000-0000-0000-000000000010', 'Atomic Save Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '7f000000-0000-0000-0000-000000000020',
  '7f000000-0000-0000-0000-000000000010',
  'manual',
  'debit',
  'Atomic save account',
  'RUB'
);

-- Create with two line items.
CREATE TEMP TABLE saved_transaction AS
SELECT public.money_save_transaction_with_line_items(
  NULL,
  jsonb_build_object(
    'payer_person_id', '7f000000-0000-0000-0000-000000000010',
    'account_id', '7f000000-0000-0000-0000-000000000020',
    'posted_at', '2026-03-05T10:00:00Z',
    'amount', -1000,
    'currency', 'RUB',
    'transaction_type', 'expense',
    'merchant_name', 'Atomic Store'
  ),
  jsonb_build_array(
    jsonb_build_object('title', 'Молоко', 'amount', -400),
    jsonb_build_object('title', 'Хлеб', 'amount', -600)
  )
) AS result;

SELECT is(
  (SELECT jsonb_array_length(result->'line_items') FROM saved_transaction),
  2,
  'creating a transaction writes its whole composition'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.money_line_items
    WHERE transaction_id = (SELECT (result->>'id')::uuid FROM saved_transaction)
  ),
  2::bigint,
  'both line items are in the registry'
);

-- Update: drop one line item, keep one, add one.
CREATE TEMP TABLE updated_transaction AS
SELECT public.money_save_transaction_with_line_items(
  (SELECT (result->>'id')::uuid FROM saved_transaction),
  jsonb_build_object('amount', -1000, 'merchant_name', 'Atomic Store'),
  jsonb_build_array(
    jsonb_build_object(
      'id', (SELECT result->'line_items'->0->>'id' FROM saved_transaction),
      'title', 'Молоко',
      'amount', -400
    ),
    jsonb_build_object('title', 'Шампунь', 'amount', -600)
  )
) AS result;

SELECT is(
  (SELECT jsonb_array_length(result->'line_items') FROM updated_transaction),
  2,
  'updating replaces the composition rather than adding to it'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.money_line_items
    WHERE transaction_id = (SELECT (result->>'id')::uuid FROM saved_transaction)
      AND title = 'Хлеб'
  ),
  0::bigint,
  'a line item left out of the payload is removed'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.money_line_items
    WHERE transaction_id = (SELECT (result->>'id')::uuid FROM saved_transaction)
      AND title = 'Шампунь'
  ),
  1::bigint,
  'a line item added in the payload is inserted'
);

-- A composition that does not add up must be refused outright, not written half-way.
SELECT throws_ok(
  format(
    $fmt$
      SELECT public.money_save_transaction_with_line_items(
        %L::uuid,
        jsonb_build_object('amount', -1000),
        jsonb_build_array(jsonb_build_object('title', 'Кофе', 'amount', -100))
      )
    $fmt$,
    (SELECT (result->>'id')::uuid FROM saved_transaction)
  ),
  'P0001',
  'Line items sum (-100.00) does not match the transaction amount (-1000.00)',
  'a composition that does not add up is rejected'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.money_line_items
    WHERE transaction_id = (SELECT (result->>'id')::uuid FROM saved_transaction)
  ),
  2::bigint,
  'the rejected save left the existing composition untouched'
);

SELECT throws_ok(
  format(
    $fmt$
      SELECT public.money_save_transaction_with_line_items(
        %L::uuid,
        jsonb_build_object('amount', -1000),
        '[]'::jsonb
      )
    $fmt$,
    (SELECT (result->>'id')::uuid FROM saved_transaction)
  ),
  'P0001',
  'A transaction needs at least one line item',
  'an empty composition is rejected'
);

SELECT * FROM finish();
ROLLBACK;
