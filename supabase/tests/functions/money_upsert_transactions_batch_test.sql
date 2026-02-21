BEGIN;
SELECT plan(11);

SELECT has_function(
  'public',
  'money_upsert_transactions_batch',
  ARRAY['uuid', 'uuid', 'jsonb']
);

SELECT function_returns(
  'public',
  'money_upsert_transactions_batch',
  ARRAY['uuid', 'uuid', 'jsonb'],
  'jsonb'
);

SELECT is(
  public.money_upsert_transactions_batch(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb)->>'error',
  'rows must be a JSON array',
  'money_upsert_transactions_batch validates rows payload shape'
);

INSERT INTO public.persons (id, name, kind)
VALUES ('77777777-7777-7777-7777-777777777777', 'Money Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '88888888-8888-8888-8888-888888888888',
  '77777777-7777-7777-7777-777777777777',
  'tbank',
  'debit',
  'Main',
  'RUB'
);

CREATE TEMP TABLE _batch_result AS
SELECT public.money_upsert_transactions_batch(
  '99999999-9999-9999-9999-999999999999'::uuid,
  '77777777-7777-7777-7777-777777777777'::uuid,
  '[
    {
      "account_id":"88888888-8888-8888-8888-888888888888",
      "source":"tbank",
      "external_id":"ext-1",
      "posted_at":"2026-02-01T10:00:00Z",
      "amount":100,
      "currency":"RUB",
      "transaction_type":"expense",
      "status":"posted",
      "merchant_name":"Coffee Shop",
      "dedupe_hash":"hash-ext-1",
      "line_item":{"title":"Latte","amount":100,"raw_payload":{"kind":"drink"}}
    },
    {
      "account_id":"88888888-8888-8888-8888-888888888888",
      "source":"tbank",
      "posted_at":"2026-02-01T11:00:00Z",
      "amount":200,
      "currency":"RUB",
      "transaction_type":"expense",
      "status":"posted",
      "merchant_name":"Grocery",
      "dedupe_hash":"hash-2"
    },
    {
      "account_id":"88888888-8888-8888-8888-888888888888",
      "source":"tbank",
      "posted_at":"2026-02-01T11:30:00Z",
      "amount":210,
      "currency":"RUB",
      "transaction_type":"expense",
      "status":"posted",
      "merchant_name":"Grocery Duplicate",
      "dedupe_hash":"hash-2"
    },
    {
      "account_id":"88888888-8888-8888-8888-888888888888",
      "source":"tbank",
      "posted_at":"2026-02-01T12:00:00Z",
      "amount":300,
      "currency":"RUB",
      "transaction_type":"expense",
      "status":"posted",
      "merchant_name":"No Hash"
    }
  ]'::jsonb
) AS payload;

SELECT is(
  ((SELECT payload FROM _batch_result)->>'inserted')::int,
  2,
  'batch inserts only unique transaction rows'
);

SELECT is(
  ((SELECT payload FROM _batch_result)->>'skipped')::int,
  2,
  'batch reports duplicate + missing dedupe hash rows as skipped'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements((SELECT payload->'row_results' FROM _batch_result)) AS r
    WHERE r->>'message' = 'Missing dedupe_hash'
  ),
  'row_results includes explicit missing dedupe_hash diagnostic'
);

SELECT is(
  (SELECT count(*) FROM public.money_transactions WHERE payer_person_id = '77777777-7777-7777-7777-777777777777'),
  2::bigint,
  'two transactions were persisted for payer'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_line_items li
    JOIN public.money_transactions t ON t.id = li.transaction_id
    WHERE t.payer_person_id = '77777777-7777-7777-7777-777777777777'
  ),
  1::bigint,
  'line item inserted only for row providing line_item payload'
);

SELECT is(
  (
    public.money_upsert_transactions_batch(
      '99999999-9999-9999-9999-999999999999'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '[
        {
          "account_id":"88888888-8888-8888-8888-888888888888",
          "source":"tbank",
          "external_id":"ext-1",
          "posted_at":"2026-02-01T10:00:00Z",
          "amount":100,
          "currency":"RUB",
          "transaction_type":"expense",
          "status":"posted",
          "merchant_name":"Coffee Shop",
          "dedupe_hash":"hash-ext-1"
        },
        {
          "account_id":"88888888-8888-8888-8888-888888888888",
          "source":"tbank",
          "posted_at":"2026-02-01T11:00:00Z",
          "amount":200,
          "currency":"RUB",
          "transaction_type":"expense",
          "status":"posted",
          "merchant_name":"Grocery",
          "dedupe_hash":"hash-2"
        }
      ]'::jsonb
    )->>'inserted'
  )::int,
  0,
  'replaying same rows does not insert duplicates'
);

SELECT is(
  (
    public.money_upsert_transactions_batch(
      '99999999-9999-9999-9999-999999999999'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '[
        {
          "account_id":"88888888-8888-8888-8888-888888888888",
          "source":"tbank",
          "external_id":"ext-1",
          "posted_at":"2026-02-01T10:00:00Z",
          "amount":100,
          "currency":"RUB",
          "transaction_type":"expense",
          "status":"posted",
          "merchant_name":"Coffee Shop",
          "dedupe_hash":"hash-ext-1"
        },
        {
          "account_id":"88888888-8888-8888-8888-888888888888",
          "source":"tbank",
          "posted_at":"2026-02-01T11:00:00Z",
          "amount":200,
          "currency":"RUB",
          "transaction_type":"expense",
          "status":"posted",
          "merchant_name":"Grocery",
          "dedupe_hash":"hash-2"
        }
      ]'::jsonb
    )->>'skipped'
  )::int,
  2,
  'replaying same rows marks both as skipped'
);

SELECT is(
  (SELECT count(*) FROM public.money_transactions WHERE payer_person_id = '77777777-7777-7777-7777-777777777777'),
  2::bigint,
  'replay keeps transaction count stable'
);

SELECT * FROM finish();
ROLLBACK;
