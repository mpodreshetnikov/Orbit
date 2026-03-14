BEGIN;
SELECT plan(23);

SELECT ok(
  to_regprocedure(
    'public.money_list_transactions_feed(uuid,text,uuid[],public.money_transaction_type[],public.money_transaction_status[],uuid[],text,text,timestamp with time zone,timestamp with time zone,integer,integer)'
  ) IS NOT NULL,
  'money_list_transactions_feed exists'
);

SELECT ok(
  to_regprocedure(
    'public.money_transaction_feed_summary(uuid,text,uuid[],public.money_transaction_type[],public.money_transaction_status[],uuid[],text,text,timestamp with time zone,timestamp with time zone)'
  ) IS NOT NULL,
  'money_transaction_feed_summary exists'
);

SELECT ok(
  to_regprocedure('public.money_write_transaction_edit_audit()') IS NOT NULL,
  'money_write_transaction_edit_audit exists'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('73000000-0000-0000-0000-000000000001', 'money-feed@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('73000000-0000-0000-0000-000000000001', 'money-feed@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('73000000-0000-0000-0000-000000000010', 'Money Feed Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES
  (
    '73000000-0000-0000-0000-000000000101',
    '73000000-0000-0000-0000-000000000010',
    'tbank',
    'debit',
    'Main account',
    'RUB'
  ),
  (
    '73000000-0000-0000-0000-000000000102',
    '73000000-0000-0000-0000-000000000010',
    'tbank',
    'debit',
    'Savings account',
    'RUB'
  );

INSERT INTO public.money_cards (id, account_id, last4, card_label)
VALUES (
  '73000000-0000-0000-0000-000000000201',
  '73000000-0000-0000-0000-000000000101',
  '4242',
  'Black card'
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
  '73000000-0000-0000-0000-000000000301',
  NULL,
  canonical.id,
  'custom',
  1,
  'Продукты',
  'Groceries',
  'money-feed-groceries'
FROM public.money_categories AS canonical
WHERE canonical.system_key = 'food';

INSERT INTO public.money_transactions (
  id,
  payer_person_id,
  account_id,
  card_id,
  source,
  external_id,
  posted_at,
  created_at,
  amount,
  currency,
  transaction_type,
  status,
  merchant_name,
  comment,
  source_comment,
  is_transfer,
  dedupe_hash
)
VALUES
  (
    '73000000-0000-0000-0000-000000000401',
    '73000000-0000-0000-0000-000000000010',
    '73000000-0000-0000-0000-000000000101',
    '73000000-0000-0000-0000-000000000201',
    'tbank',
    'feed-ext-1',
    '2026-03-03T12:00:00Z',
    '2026-03-03T12:05:00Z',
    -120,
    'RUB',
    'expense',
    'posted',
    'Coffee Planet',
    'Morning coffee',
    'Barista note',
    false,
    'feed-hash-1'
  ),
  (
    '73000000-0000-0000-0000-000000000402',
    '73000000-0000-0000-0000-000000000010',
    '73000000-0000-0000-0000-000000000101',
    NULL,
    'tbank',
    'feed-ext-2',
    '2026-03-03T12:00:00Z',
    '2026-03-03T12:01:00Z',
    -450,
    'RUB',
    'expense',
    'pending',
    'Fresh Market',
    'Weekly groceries',
    'Bulk produce',
    false,
    'feed-hash-2'
  ),
  (
    '73000000-0000-0000-0000-000000000403',
    '73000000-0000-0000-0000-000000000010',
    '73000000-0000-0000-0000-000000000102',
    NULL,
    'tbank',
    'feed-ext-3',
    '2026-03-02T09:00:00Z',
    '2026-03-02T09:10:00Z',
    2500,
    'RUB',
    'income',
    'posted',
    'Payroll Ltd',
    'March salary',
    'Salary source memo',
    false,
    'feed-hash-3'
  ),
  (
    '73000000-0000-0000-0000-000000000404',
    '73000000-0000-0000-0000-000000000010',
    '73000000-0000-0000-0000-000000000101',
    NULL,
    'tbank',
    'feed-ext-4',
    '2026-03-01T08:00:00Z',
    '2026-03-01T08:05:00Z',
    -1500,
    'RUB',
    'transfer',
    'posted',
    'Move To Savings',
    'Personal transfer',
    'Internal transfer memo',
    true,
    'feed-hash-4'
  );

INSERT INTO public.money_line_items (
  id,
  transaction_id,
  title,
  amount,
  category_id
)
VALUES
  (
    '73000000-0000-0000-0000-000000000501',
    '73000000-0000-0000-0000-000000000401',
    'Latte',
    -120,
    '73000000-0000-0000-0000-000000000301'
  ),
  (
    '73000000-0000-0000-0000-000000000502',
    '73000000-0000-0000-0000-000000000402',
    'Blueberries',
    -450,
    '73000000-0000-0000-0000-000000000301'
  ),
  (
    '73000000-0000-0000-0000-000000000503',
    '73000000-0000-0000-0000-000000000403',
    'Salary payout',
    2500,
    NULL
  ),
  (
    '73000000-0000-0000-0000-000000000504',
    '73000000-0000-0000-0000-000000000404',
    'Savings top-up',
    -1500,
    NULL
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-feed@example.com', true);
SELECT set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000001', true);

SELECT is(
  (
    WITH feed AS (
      SELECT row_number() OVER () AS rn, id
      FROM public.money_list_transactions_feed(
        '73000000-0000-0000-0000-000000000010'::uuid,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'all',
        'all',
        NULL,
        NULL,
        0,
        10
      )
    )
    SELECT string_agg(id::text, ',' ORDER BY rn)
    FROM feed
  ),
  '73000000-0000-0000-0000-000000000401,73000000-0000-0000-0000-000000000402,73000000-0000-0000-0000-000000000403,73000000-0000-0000-0000-000000000404',
  'feed orders rows by posted_at desc, created_at desc, id desc'
);

SELECT is(
  (
    SELECT max(total_count)
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
  ),
  4::bigint,
  'feed exposes total_count across the filtered result set'
);

SELECT is(
  (
    SELECT total_count
    FROM public.money_transaction_feed_summary(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL
    )
  ),
  4::bigint,
  'summary exposes total_count across the filtered result set'
);

SELECT is(
  (
    SELECT total_positive_amount
    FROM public.money_transaction_feed_summary(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL
    )
  ),
  2500::numeric,
  'summary exposes total positive amount across the filtered result set'
);

SELECT is(
  (
    SELECT total_negative_amount
    FROM public.money_transaction_feed_summary(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL
    )
  ),
  -2070::numeric,
  'summary exposes total negative amount across the filtered result set'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      'coffee',
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000401',
  'search matches merchant_name'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      'march salary',
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000403',
  'search matches transaction comment'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      'salary source memo',
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000403',
  'search matches source comment'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      'blueberr',
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000402',
  'search matches line item title'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      ARRAY['73000000-0000-0000-0000-000000000102'::uuid],
      NULL,
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000403',
  'feed filters by account ids'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      ARRAY['income'::public.money_transaction_type],
      NULL,
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000403',
  'feed filters by transaction types'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      ARRAY['pending'::public.money_transaction_status],
      NULL,
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000402',
  'feed filters by statuses'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      NULL,
      ARRAY['73000000-0000-0000-0000-000000000301'::uuid],
      'all',
      'all',
      NULL,
      NULL,
      0,
      10
    )
  ),
  2::bigint,
  'feed filters by line item category membership'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'only',
      'all',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000404',
  'feed transfer filter supports only'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_list_transactions_feed(
      '73000000-0000-0000-0000-000000000010'::uuid,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'all',
      'income',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '73000000-0000-0000-0000-000000000403',
  'feed amount sign filter supports income'
);

SELECT is(
  (
    WITH feed AS (
      SELECT row_number() OVER () AS rn, id
      FROM public.money_list_transactions_feed(
        '73000000-0000-0000-0000-000000000010'::uuid,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'all',
        'all',
        '2026-03-03T00:00:00Z'::timestamptz,
        '2026-03-03T23:59:59Z'::timestamptz,
        0,
        10
      )
    )
    SELECT string_agg(id::text, ',' ORDER BY rn)
    FROM feed
  ),
  '73000000-0000-0000-0000-000000000401,73000000-0000-0000-0000-000000000402',
  'feed filters by inclusive posted_at range'
);

SELECT is(
  (
    WITH feed AS (
      SELECT row_number() OVER () AS rn, id
      FROM public.money_list_transactions_feed(
        '73000000-0000-0000-0000-000000000010'::uuid,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'all',
        'all',
        NULL,
        NULL,
        1,
        2
      )
    )
    SELECT string_agg(id::text, ',' ORDER BY rn)
    FROM feed
  ),
  '73000000-0000-0000-0000-000000000402,73000000-0000-0000-0000-000000000403',
  'feed applies offset and limit after stable ordering'
);

UPDATE public.money_transactions
SET comment = 'Morning coffee updated'
WHERE id = '73000000-0000-0000-0000-000000000401';

UPDATE public.money_line_items
SET title = 'Iced latte'
WHERE id = '73000000-0000-0000-0000-000000000501';

UPDATE public.money_transactions
SET comment = 'Morning coffee updated'
WHERE id = '73000000-0000-0000-0000-000000000401';

SELECT is(
  (
    SELECT jsonb_build_object(
      'entity_kind', entity_kind,
      'entity_id', entity_id,
      'edited_by_auth_user_id', edited_by_auth_user_id,
      'before_comment', before_snapshot->>'comment',
      'after_comment', after_snapshot->>'comment'
    )
    FROM public.money_transaction_edit_audits
    WHERE transaction_id = '73000000-0000-0000-0000-000000000401'
      AND entity_kind = 'transaction'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  jsonb_build_object(
    'entity_kind', 'transaction',
    'entity_id', '73000000-0000-0000-0000-000000000401',
    'edited_by_auth_user_id', '73000000-0000-0000-0000-000000000001',
    'before_comment', 'Morning coffee',
    'after_comment', 'Morning coffee updated'
  ),
  'transaction update trigger writes audit row with auth uid and snapshots'
);

SELECT is(
  (
    SELECT jsonb_build_object(
      'entity_kind', entity_kind,
      'entity_id', entity_id,
      'before_title', before_snapshot->>'title',
      'after_title', after_snapshot->>'title'
    )
    FROM public.money_transaction_edit_audits
    WHERE transaction_id = '73000000-0000-0000-0000-000000000401'
      AND entity_kind = 'line_item'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  jsonb_build_object(
    'entity_kind', 'line_item',
    'entity_id', '73000000-0000-0000-0000-000000000501',
    'before_title', 'Latte',
    'after_title', 'Iced latte'
  ),
  'line item update trigger writes audit row with before and after snapshots'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_transaction_edit_audits
    WHERE transaction_id = '73000000-0000-0000-0000-000000000401'
  ),
  2::bigint,
  'no-op updates do not create extra audit rows'
);

SELECT * FROM finish();
ROLLBACK;
