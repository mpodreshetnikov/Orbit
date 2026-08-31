BEGIN;
SELECT plan(16);

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

INSERT INTO public.money_transaction_brands (
  id,
  slug,
  name,
  website_url,
  logo_url,
  base_color,
  base_text_color
)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'coffee-shop',
  'Coffee Shop',
  'https://coffee.example',
  'https://cdn.example/coffee.png',
  '#112233',
  '#ffffff'
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
      "source_comment":"SOURCE COFFEE",
      "cashback_amount":"5",
      "cashback_currency":"RUB",
      "operation_icon_url":"https://cdn.example/icon.png",
      "source_category_id":"bank-food",
      "source_category_name":"Food",
      "brand_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
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
    SELECT jsonb_build_object(
      'source_comment', source_comment,
      'cashback_amount', cashback_amount,
      'cashback_currency', cashback_currency,
      'operation_icon_url', operation_icon_url,
      'source_category_id', source_category_id,
      'source_category_name', source_category_name,
      'brand_id', brand_id
    )
    FROM public.money_transactions
    WHERE external_id = 'ext-1'
  ),
  jsonb_build_object(
    'source_comment', 'SOURCE COFFEE',
    'cashback_amount', 5,
    'cashback_currency', 'RUB',
    'operation_icon_url', 'https://cdn.example/icon.png',
    'source_category_id', 'bank-food',
    'source_category_name', 'Food',
    'brand_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'batch persists new import metadata fields on the inserted transaction'
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

CREATE TEMP TABLE _replay_result AS
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
      "merchant_name":"Coffee Shop Replay",
      "source_comment":"SOURCE COFFEE UPDATED",
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
      "merchant_name":"Grocery Replay",
      "dedupe_hash":"hash-2"
    }
  ]'::jsonb
) AS payload;

SELECT is(
  ((SELECT payload FROM _replay_result)->>'inserted')::int,
  0,
  'replaying same rows does not insert duplicates'
);

SELECT is(
  ((SELECT payload FROM _replay_result)->>'skipped')::int,
  2,
  'replaying same rows marks both as skipped'
);

SELECT is(
  (SELECT count(*) FROM public.money_transactions WHERE payer_person_id = '77777777-7777-7777-7777-777777777777'),
  2::bigint,
  'replay keeps transaction count stable'
);

SELECT is(
  (
    SELECT jsonb_build_object(
      'merchant_name', merchant_name,
      'source_comment', source_comment
    )
    FROM public.money_transactions
    WHERE external_id = 'ext-1'
  ),
  jsonb_build_object(
    'merchant_name', 'Coffee Shop Replay',
    'source_comment', 'SOURCE COFFEE UPDATED'
  ),
  'replaying same rows updates the existing transaction payload'
);

-- Transaction identity is scoped to the payer (20260814093000_scope_money_transaction_identity).
-- Before that migration both identity indexes were global, so a second person importing from
-- the same bank landed on the first person's rows: the unique violation resolved to an UPDATE
-- reported as a harmless-looking `skipped`, and one household member's operations overwrote
-- another's. These rows repeat the first person's external id and dedupe hash exactly.
INSERT INTO public.persons (id, name, kind)
VALUES ('77777777-7777-7777-7777-777777777778', 'Other Money Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '88888888-8888-8888-8888-888888888889',
  '77777777-7777-7777-7777-777777777778',
  'tbank',
  'debit',
  'Other Main',
  'RUB'
);

CREATE TEMP TABLE _other_person_result AS
SELECT public.money_upsert_transactions_batch(
  '99999999-9999-9999-9999-99999999999a'::uuid,
  '77777777-7777-7777-7777-777777777778'::uuid,
  '[
    {
      "account_id":"88888888-8888-8888-8888-888888888889",
      "source":"tbank",
      "external_id":"ext-1",
      "posted_at":"2026-02-01T10:00:00Z",
      "amount":100,
      "currency":"RUB",
      "transaction_type":"expense",
      "status":"posted",
      "merchant_name":"Coffee Shop Other Person",
      "dedupe_hash":"hash-ext-1"
    },
    {
      "account_id":"88888888-8888-8888-8888-888888888889",
      "source":"tbank",
      "posted_at":"2026-02-01T11:00:00Z",
      "amount":200,
      "currency":"RUB",
      "transaction_type":"expense",
      "status":"posted",
      "merchant_name":"Grocery Other Person",
      "dedupe_hash":"hash-2"
    }
  ]'::jsonb
) AS payload;

SELECT is(
  ((SELECT payload FROM _other_person_result)->>'inserted')::int,
  2,
  'another payer reusing the same external id and dedupe hash gets their own transactions'
);

SELECT is(
  (SELECT count(*) FROM public.money_transactions WHERE payer_person_id = '77777777-7777-7777-7777-777777777778'),
  2::bigint,
  'the second payer keeps both of their rows'
);

SELECT is(
  (
    SELECT jsonb_build_object(
      'merchant_name', merchant_name,
      'source_comment', source_comment
    )
    FROM public.money_transactions
    WHERE external_id = 'ext-1'
      AND payer_person_id = '77777777-7777-7777-7777-777777777777'
  ),
  jsonb_build_object(
    'merchant_name', 'Coffee Shop Replay',
    'source_comment', 'SOURCE COFFEE UPDATED'
  ),
  'the first payer''s transaction is untouched by the second payer''s import'
);

SELECT * FROM finish();
ROLLBACK;
