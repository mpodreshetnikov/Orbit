BEGIN;
SELECT plan(6);

SELECT ok(
  to_regclass('public.money_transaction_brands') IS NOT NULL,
  'money_transaction_brands table exists'
);
SELECT ok(
  to_regclass('public.money_transaction_brand_aliases') IS NOT NULL,
  'money_transaction_brand_aliases table exists'
);

INSERT INTO public.persons (id, name, kind)
VALUES ('a1000000-0000-0000-0000-000000000001', 'Brand Test Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000001',
  'manual',
  'debit',
  'Brand Test Account',
  'RUB'
);

INSERT INTO public.money_transaction_brands (
  id,
  slug,
  name
)
VALUES (
  'a1000000-0000-0000-0000-000000000003',
  'brand-test',
  'Brand Test'
);

INSERT INTO public.money_transaction_brand_aliases (
  id,
  brand_id,
  source,
  source_key,
  source_name
)
VALUES (
  'a1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000003',
  'tbank',
  'merchant-brand-test',
  'Brand Test'
);

SELECT throws_ok(
  $$
    INSERT INTO public.money_transaction_brand_aliases (
      id,
      brand_id,
      source,
      source_key,
      source_name
    )
    VALUES (
      'a1000000-0000-0000-0000-000000000005',
      'a1000000-0000-0000-0000-000000000003',
      'tbank',
      'merchant-brand-test',
      'Brand Test Duplicate'
    )
  $$,
  '23505',
  NULL,
  'brand aliases enforce unique source/source_key pairs'
);

SELECT throws_ok(
  $$
    INSERT INTO public.money_transaction_brand_aliases (
      id,
      brand_id,
      source,
      source_key,
      source_name
    )
    VALUES (
      'a1000000-0000-0000-0000-000000000006',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'tbank',
      'missing-brand',
      'Missing Brand'
    )
  $$,
  '23503',
  NULL,
  'brand aliases require a valid canonical brand'
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
  brand_id,
  dedupe_hash
)
VALUES (
  'a1000000-0000-0000-0000-000000000007',
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'manual',
  '2026-03-01T10:00:00Z',
  123,
  'RUB',
  'expense',
  'posted',
  'Brand Test Merchant',
  'a1000000-0000-0000-0000-000000000003',
  'brand-test-hash'
);

SELECT is(
  (
    SELECT brand_id::text
    FROM public.money_transactions
    WHERE id = 'a1000000-0000-0000-0000-000000000007'
  ),
  'a1000000-0000-0000-0000-000000000003',
  'money_transactions stores canonical brand references'
);

SELECT throws_ok(
  $$
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
      brand_id,
      dedupe_hash
    )
    VALUES (
      'a1000000-0000-0000-0000-000000000008',
      'a1000000-0000-0000-0000-000000000001',
      'a1000000-0000-0000-0000-000000000002',
      'manual',
      '2026-03-01T11:00:00Z',
      456,
      'RUB',
      'expense',
      'posted',
      'Broken Brand Merchant',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'brand-test-hash-2'
    )
  $$,
  '23503',
  NULL,
  'money_transactions.brand_id enforces the canonical brand foreign key'
);

SELECT * FROM finish();
ROLLBACK;
