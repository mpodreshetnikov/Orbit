BEGIN;
SELECT plan(15);

SELECT has_function('public', 'get_person_conditions_with_history', ARRAY['uuid']);
SELECT has_function('public', 'get_record_conditions', ARRAY['uuid']);
SELECT has_function('public', 'get_record_findings', ARRAY['uuid']);
SELECT has_function('public', 'get_record_observations', ARRAY['uuid']);
SELECT has_function(
  'public',
  'search_medical_records',
  ARRAY[
    'text',
    'uuid',
    'record_type',
    'record_status',
    'integer',
    'integer',
    'text[]'
  ]
);
SELECT has_function('public', 'get_money_merchant_default_categories', ARRAY['uuid']);
SELECT has_function(
  'public',
  'get_checkup_notification_payload_for_person',
  ARRAY['uuid', 'date', 'time without time zone', 'text']
);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('77777777-0000-0000-0000-000000000000', 'query-user@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('77777777-0000-0000-0000-000000000000', 'query-user@example.com');

SELECT set_config('request.jwt.claim.sub', '77777777-0000-0000-0000-000000000000', true);
SELECT set_config('request.jwt.claim.email', 'query-user@example.com', true);

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '88888888-0000-0000-0000-000000000000',
  'Query Person',
  'human',
  '77777777-0000-0000-0000-000000000000'
);

INSERT INTO public.medical_records (
  id,
  person_id,
  created_by_user_id,
  record_type,
  record_date,
  title,
  notes,
  status
)
VALUES (
  '99999999-0000-0000-0000-000000000000',
  '88888888-0000-0000-0000-000000000000',
  '77777777-0000-0000-0000-000000000000',
  'lab',
  '2026-02-01'::date,
  'Migraine blood panel',
  'Follow-up migraine markers',
  'active'
);

INSERT INTO public.conditions (
  id,
  person_id,
  name,
  icd_name_en,
  icd_name_ru,
  code,
  current_status
)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000000',
  '88888888-0000-0000-0000-000000000000',
  'Migraine',
  'Migraine',
  'Мигрень',
  'G43',
  'active'
);

INSERT INTO public.condition_records (
  condition_id,
  record_id,
  status_in_record,
  source_anchor,
  confidence
)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000000',
  '99999999-0000-0000-0000-000000000000',
  'active',
  'anchor-1',
  0.95
);

INSERT INTO public.finding_type_catalog (id, finding_code, name_ru, name_en)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000000',
  'FIND-1',
  'Узел',
  'Nodule'
);

INSERT INTO public.body_site_catalog (id, site_code, name_ru, name_en)
VALUES (
  'cccccccc-0000-0000-0000-000000000000',
  'HEAD',
  'Голова',
  'Head'
);

INSERT INTO public.record_findings (
  person_id,
  record_id,
  finding_type_id,
  finding_code,
  finding_type_text,
  body_site_id,
  site_code,
  body_site_text,
  source_anchor
)
VALUES (
  '88888888-0000-0000-0000-000000000000',
  '99999999-0000-0000-0000-000000000000',
  'bbbbbbbb-0000-0000-0000-000000000000',
  'FIND-1',
  'Nodule',
  'cccccccc-0000-0000-0000-000000000000',
  'HEAD',
  'Head',
  'finding-anchor'
);

INSERT INTO public.observation_catalog (
  id,
  obs_code,
  name_ru,
  name_en,
  canonical_unit,
  accepted_units
)
VALUES (
  'dddddddd-0000-0000-0000-000000000000',
  'GLU',
  'Глюкоза',
  'Glucose',
  'mmol/L',
  '{"mmol/L":{"factor_to_canonical":1}}'::jsonb
);

INSERT INTO public.record_observations (
  record_id,
  catalog_id,
  obs_code,
  obs_name,
  value_numeric,
  unit,
  value_canonical,
  unit_canonical,
  status
)
VALUES (
  '99999999-0000-0000-0000-000000000000',
  'dddddddd-0000-0000-0000-000000000000',
  'GLU',
  'Glucose',
  5.2,
  'mmol/L',
  5.2,
  'mmol/L',
  'normal'
);

INSERT INTO public.money_categories (id, depth, name_ru, name_en, slug)
VALUES ('eeeeeeee-0000-0000-0000-000000000000', 1, 'Продукты', 'Groceries', 'groceries-root');

INSERT INTO public.money_accounts (id, owner_person_id, source, account_kind, account_label, currency)
VALUES (
  'ffffffff-0000-0000-0000-000000000000',
  '88888888-0000-0000-0000-000000000000',
  'manual',
  'debit',
  'Wallet',
  'RUB'
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
  dedupe_hash
)
VALUES (
  '11111111-2222-3333-4444-555555555555',
  '88888888-0000-0000-0000-000000000000',
  'ffffffff-0000-0000-0000-000000000000',
  'manual',
  now(),
  120,
  'RUB',
  'expense',
  'posted',
  'Cafe Place',
  'query-hash-1'
);

INSERT INTO public.money_line_items (transaction_id, title, amount, category_id)
VALUES (
  '11111111-2222-3333-4444-555555555555',
  'Lunch',
  120,
  'eeeeeeee-0000-0000-0000-000000000000'
);

INSERT INTO public.checkup_items (
  id,
  person_id,
  title,
  category,
  schedule,
  next_due_at,
  planned_on,
  reminder_days_before
)
VALUES
  (
    '12121212-1212-1212-1212-121212121212',
    '88888888-0000-0000-0000-000000000000',
    'Old blood panel',
    'lab',
    '{}'::jsonb,
    '2026-01-31'::date,
    '2026-01-31'::date,
    ARRAY[1]
  ),
  (
    '34343434-3434-3434-3434-343434343434',
    '88888888-0000-0000-0000-000000000000',
    'Today ultrasound',
    'imaging',
    '{}'::jsonb,
    '2026-02-01'::date,
    NULL,
    ARRAY[3]
  );

SELECT is(
  (
    SELECT mention_count
    FROM public.get_person_conditions_with_history('88888888-0000-0000-0000-000000000000')
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000000'
  ),
  1::bigint,
  'get_person_conditions_with_history reports linked mention count'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_record_conditions('99999999-0000-0000-0000-000000000000')
  ),
  1::bigint,
  'get_record_conditions returns linked condition rows'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_record_findings('99999999-0000-0000-0000-000000000000')
  ),
  1::bigint,
  'get_record_findings returns finding rows with catalog joins'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_record_observations('99999999-0000-0000-0000-000000000000')
  ),
  1::bigint,
  'get_record_observations returns observation rows with catalog data'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.search_medical_records(
      'Migraine',
      '88888888-0000-0000-0000-000000000000',
      NULL,
      NULL,
      20,
      0,
      NULL
    )
  ),
  1::bigint,
  'search_medical_records finds record by title text'
);

SELECT is(
  (
    SELECT category_id::text
    FROM public.get_money_merchant_default_categories('88888888-0000-0000-0000-000000000000')
    WHERE merchant_name = 'Cafe Place'
    LIMIT 1
  ),
  'eeeeeeee-0000-0000-0000-000000000000',
  'get_money_merchant_default_categories returns top category per merchant'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_checkup_notification_payload_for_person(
      '88888888-0000-0000-0000-000000000000',
      '2026-02-01'::date,
      '09:00'::time,
      'UTC'
    )
  ),
  1::bigint,
  'get_checkup_notification_payload_for_person emits one row when overdue/reminder items exist'
);

SELECT ok(
  (
    SELECT body LIKE 'Overdue:%'
    FROM public.get_checkup_notification_payload_for_person(
      '88888888-0000-0000-0000-000000000000',
      '2026-02-01'::date,
      '09:00'::time,
      'UTC'
    )
    LIMIT 1
  ),
  'checkup payload body starts with overdue section when overdue items exist'
);

SELECT * FROM finish();
ROLLBACK;
