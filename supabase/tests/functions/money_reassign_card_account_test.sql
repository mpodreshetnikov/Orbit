BEGIN;
SELECT plan(12);

SELECT has_function(
  'public',
  'money_reassign_card_account',
  ARRAY['uuid', 'uuid']
);

SELECT function_returns(
  'public',
  'money_reassign_card_account',
  ARRAY['uuid', 'uuid'],
  'record'
);

INSERT INTO public.persons (id, name, kind)
VALUES
  ('70000000-0000-0000-0000-000000000001', 'Money Reassign Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES
  ('70000000-0000-0000-0000-000000000101', '70000000-0000-0000-0000-000000000001', 'tbank', 'debit', 'Primary', 'RUB'),
  ('70000000-0000-0000-0000-000000000102', '70000000-0000-0000-0000-000000000001', 'tbank', 'debit', 'Secondary', 'RUB'),
  ('70000000-0000-0000-0000-000000000103', '70000000-0000-0000-0000-000000000001', 'tbank', 'debit', 'Merge Source', 'RUB'),
  ('70000000-0000-0000-0000-000000000104', '70000000-0000-0000-0000-000000000001', 'tbank', 'debit', 'Merge Target', 'RUB'),
  ('70000000-0000-0000-0000-000000000105', '70000000-0000-0000-0000-000000000001', 'manual', 'debit', 'Manual Account', 'RUB');

INSERT INTO public.money_cards (id, account_id, last4, card_label)
VALUES
  ('70000000-0000-0000-0000-000000000201', '70000000-0000-0000-0000-000000000101', '1111', 'Move Card'),
  ('70000000-0000-0000-0000-000000000202', '70000000-0000-0000-0000-000000000103', '2222', 'Merge Card Source'),
  ('70000000-0000-0000-0000-000000000203', '70000000-0000-0000-0000-000000000104', '2222', 'Merge Card Target');

INSERT INTO public.money_transactions (
  id,
  payer_person_id,
  account_id,
  card_id,
  source,
  external_id,
  posted_at,
  amount,
  currency,
  transaction_type,
  status,
  merchant_name,
  dedupe_hash
)
VALUES
  (
    '70000000-0000-0000-0000-000000000301',
    '70000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000101',
    '70000000-0000-0000-0000-000000000201',
    'tbank',
    'move-ext-1',
    '2026-03-01T10:00:00Z',
    -100,
    'RUB',
    'expense',
    'posted',
    'Move merchant',
    'move-hash-1'
  ),
  (
    '70000000-0000-0000-0000-000000000302',
    '70000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000103',
    '70000000-0000-0000-0000-000000000202',
    'tbank',
    'merge-ext-1',
    '2026-03-01T11:00:00Z',
    -200,
    'RUB',
    'expense',
    'posted',
    'Merge merchant',
    'merge-hash-1'
  );

CREATE TEMP TABLE _move_result AS
SELECT * FROM public.money_reassign_card_account(
  '70000000-0000-0000-0000-000000000201'::uuid,
  '70000000-0000-0000-0000-000000000102'::uuid
);

SELECT is(
  (SELECT merged FROM _move_result),
  false,
  'normal move path keeps merged=false'
);

SELECT is(
  (SELECT resulting_card_id::text FROM _move_result),
  '70000000-0000-0000-0000-000000000201',
  'normal move path keeps original card id'
);

SELECT is(
  (SELECT moved_transactions_count FROM _move_result),
  1,
  'normal move path updates transactions for source card'
);

SELECT is(
  (
    SELECT account_id::text
    FROM public.money_cards
    WHERE id = '70000000-0000-0000-0000-000000000201'
  ),
  '70000000-0000-0000-0000-000000000102',
  'normal move path updates card account'
);

CREATE TEMP TABLE _merge_result AS
SELECT * FROM public.money_reassign_card_account(
  '70000000-0000-0000-0000-000000000202'::uuid,
  '70000000-0000-0000-0000-000000000104'::uuid
);

SELECT is(
  (SELECT merged FROM _merge_result),
  true,
  'merge path marks merged=true'
);

SELECT is(
  (SELECT resulting_card_id::text FROM _merge_result),
  '70000000-0000-0000-0000-000000000203',
  'merge path uses existing target card id'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_cards
    WHERE id = '70000000-0000-0000-0000-000000000202'
  ),
  0::bigint,
  'merge path deletes source card'
);

SELECT is(
  (
    SELECT card_id::text
    FROM public.money_transactions
    WHERE id = '70000000-0000-0000-0000-000000000302'
  ),
  '70000000-0000-0000-0000-000000000203',
  'merge path rewires transaction card_id to existing target card'
);

SELECT is(
  (
    SELECT account_id::text
    FROM public.money_transactions
    WHERE id = '70000000-0000-0000-0000-000000000302'
  ),
  '70000000-0000-0000-0000-000000000104',
  'merge path rewires transaction account_id to target account'
);

SELECT throws_ok(
  $$ SELECT public.money_reassign_card_account(
    '70000000-0000-0000-0000-000000000201'::uuid,
    '70000000-0000-0000-0000-000000000105'::uuid
  ) $$,
  'Target account must use the same source',
  'validation rejects remap to account with different source'
);

SELECT * FROM finish();
ROLLBACK;
