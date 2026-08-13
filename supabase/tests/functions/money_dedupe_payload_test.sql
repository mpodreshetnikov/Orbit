BEGIN;
SELECT plan(8);

SELECT has_function(
  'public',
  'money_build_dedupe_payload',
  ARRAY['text', 'timestamp with time zone', 'numeric', 'text', 'text', 'text', 'integer']
);

-- These expectations are the output of buildMoneyDedupePayload in shared/lib/money/dedupe.ts for the
-- same inputs, and the same strings are asserted there. The two implementations must agree
-- character for character: the migration that recomputes stored hashes builds the payload here,
-- while re-importing the same statement afterwards builds it in TypeScript. One character of drift
-- and every row of that statement is imported a second time.

SELECT is(
  public.money_build_dedupe_payload(
    'tbank',
    '2026-02-01T12:30:00+03:00'::timestamptz,
    -120.5,
    'RUB',
    'Coffee',
    '1234',
    0
  ),
  'tbank|2026-02-01T09:30:00.000Z|-120.50|RUB|Coffee|1234|0',
  'payload matches the TypeScript formula'
);

SELECT is(
  public.money_build_dedupe_payload(
    'tbank',
    '2026-02-01T12:30:00+03:00'::timestamptz,
    -120.5,
    'RUB',
    'Coffee',
    '1234',
    1
  ),
  'tbank|2026-02-01T09:30:00.000Z|-120.50|RUB|Coffee|1234|1',
  'the occurrence separates two otherwise identical rows'
);

SELECT is(
  public.money_build_dedupe_payload(
    'tbank',
    '2026-02-02T00:00:00+03:00'::timestamptz,
    5000,
    'RUB',
    NULL,
    NULL,
    0
  ),
  'tbank|2026-02-01T21:00:00.000Z|5000.00|RUB|||0',
  'empty merchant and account hint render as empty fields, not dropped ones'
);

SELECT is(
  public.money_build_dedupe_payload(
    'tbank',
    '2026-02-01T09:30:00.000Z'::timestamptz,
    -120.5,
    ' rub ',
    '  Coffee  ',
    '1234',
    0
  ),
  'tbank|2026-02-01T09:30:00.000Z|-120.50|RUB|Coffee|1234|0',
  'currency case and surrounding space are canonicalised'
);

SELECT is(
  public.money_build_dedupe_payload('tbank', '2026-02-01T09:30:00Z'::timestamptz, 0, 'RUB', NULL, NULL, 0),
  'tbank|2026-02-01T09:30:00.000Z|0.00|RUB|||0',
  'a zero amount renders with two decimals'
);

-- The digest the migration stores, cross-checked against the value shared/lib/money/dedupe.test.ts
-- asserts for the same input.
SELECT is(
  encode(
    digest(
      public.money_build_dedupe_payload(
        'tbank',
        '2026-02-01T12:30:00+03:00'::timestamptz,
        -120.5,
        'RUB',
        'Coffee',
        '1234',
        0
      ),
      'sha256'
    ),
    'hex'
  ),
  '429706684e66e43626026281bc0b84f955df00f25e8af76fee7caddd79481fb4',
  'the SQL digest equals the TypeScript digest for the same row'
);

SELECT ok(
  (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_money_transactions_person_dedupe_hash'
  ) = 1,
  'transaction identity by dedupe hash is scoped to the person'
);

SELECT ok(
  (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_money_transactions_person_source_external_id'
  ) = 1,
  'transaction identity by external id is scoped to the person'
);

SELECT * FROM finish();
ROLLBACK;
