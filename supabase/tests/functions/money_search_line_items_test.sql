BEGIN;
SELECT plan(6);

SELECT ok(
  to_regprocedure(
    'public.money_search_line_items(uuid,text,timestamp with time zone,timestamp with time zone,integer,integer)'
  ) IS NOT NULL,
  'money_search_line_items exists'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('74000000-0000-0000-0000-000000000001', 'money-line-search@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('74000000-0000-0000-0000-000000000001', 'money-line-search@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('74000000-0000-0000-0000-000000000010', 'Line Search Person', 'human');

INSERT INTO public.money_accounts (id, owner_person_id, source, account_kind, account_label, currency)
VALUES ('74000000-0000-0000-0000-000000000101', '74000000-0000-0000-0000-000000000010', 'manual', 'debit', 'Cash', 'RUB');

INSERT INTO public.money_transactions (
  id, payer_person_id, account_id, source, posted_at, amount, currency, transaction_type, merchant_name, comment, dedupe_hash
)
VALUES
  (
    '74000000-0000-0000-0000-000000000401',
    '74000000-0000-0000-0000-000000000010',
    '74000000-0000-0000-0000-000000000101',
    'manual',
    '2026-10-10T12:00:00Z',
    -100,
    'RUB',
    'expense',
    'МолокоМаг',
    NULL,
    'line-search-hash-1'
  ),
  (
    '74000000-0000-0000-0000-000000000402',
    '74000000-0000-0000-0000-000000000010',
    '74000000-0000-0000-0000-000000000101',
    'manual',
    '2026-10-11T12:00:00Z',
    -200,
    'RUB',
    'expense',
    'Bakery',
    'про молоко в комментарии',
    'line-search-hash-2'
  ),
  (
    '74000000-0000-0000-0000-000000000403',
    '74000000-0000-0000-0000-000000000010',
    '74000000-0000-0000-0000-000000000101',
    'manual',
    '2026-10-12T12:00:00Z',
    -300,
    'RUB',
    'expense',
    'Shop',
    NULL,
    'line-search-hash-3'
  );

INSERT INTO public.money_line_items (id, transaction_id, title, amount)
VALUES
  ('74000000-0000-0000-0000-000000000501', '74000000-0000-0000-0000-000000000401', 'Хлеб', -100),
  ('74000000-0000-0000-0000-000000000502', '74000000-0000-0000-0000-000000000402', 'Булка', -200),
  ('74000000-0000-0000-0000-000000000503', '74000000-0000-0000-0000-000000000403', 'Молоко 3.2%', -150),
  ('74000000-0000-0000-0000-000000000504', '74000000-0000-0000-0000-000000000403', 'Сыр', -150);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-line-search@example.com', true);
SELECT set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000001', true);

-- Merchant/comment contain "молоко" but only one tx has it on a receipt line.
SELECT is(
  (
    SELECT max(total_count)
    FROM public.money_search_line_items(
      '74000000-0000-0000-0000-000000000010'::uuid,
      'МОЛОКО',
      NULL,
      NULL,
      0,
      10
    )
  ),
  1::bigint,
  'title predicate counts only receipt-title hits, not merchant/comment'
);

SELECT is(
  (
    SELECT id::text
    FROM public.money_search_line_items(
      '74000000-0000-0000-0000-000000000010'::uuid,
      'молоко',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  '74000000-0000-0000-0000-000000000403',
  'Cyrillic ILIKE finds the title-matching transaction'
);

SELECT is(
  (
    SELECT jsonb_array_length(matching_line_items)
    FROM public.money_search_line_items(
      '74000000-0000-0000-0000-000000000010'::uuid,
      'молоко',
      NULL,
      NULL,
      0,
      10
    )
    LIMIT 1
  ),
  1,
  'returns only matching lines, not the whole receipt'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_search_line_items(
      '74000000-0000-0000-0000-000000000010'::uuid,
      'молоко',
      NULL,
      NULL,
      1,
      10
    )
  ),
  0::bigint,
  'offset past title hits returns an empty page'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_search_line_items(
      '74000000-0000-0000-0000-000000000010'::uuid,
      '   ',
      NULL,
      NULL,
      0,
      10
    )
  ),
  0::bigint,
  'blank query returns no rows'
);

SELECT * FROM finish();
ROLLBACK;
