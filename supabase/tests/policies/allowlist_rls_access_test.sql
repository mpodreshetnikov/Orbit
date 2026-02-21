BEGIN;
SELECT plan(10);

INSERT INTO public.allowed_users (email)
VALUES ('allowlist-pass@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('eeeeeeee-5555-5555-5555-555555555555', 'Allowlist Person', 'human');

INSERT INTO public.med_regimens (
  id,
  person_id,
  custom_name,
  schedule,
  duration,
  dose_definition,
  inventory
)
VALUES (
  'ffffffff-6666-6666-6666-666666666666',
  'eeeeeeee-5555-5555-5555-555555555555',
  'Allowlist Regimen',
  '{"mode":"daily_times","times":["09:00"],"amounts":[1]}'::jsonb,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
  '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":5,"refill_threshold_amount":1,"unit":"pill"}'::jsonb
);

INSERT INTO public.med_dose_events (
  id,
  person_id,
  regimen_id,
  scheduled_at,
  actual_at,
  planned_intake,
  status
)
VALUES (
  'abababab-8888-8888-8888-888888888888',
  'eeeeeeee-5555-5555-5555-555555555555',
  'ffffffff-6666-6666-6666-666666666666',
  now() + interval '1 hour',
  now() + interval '1 hour',
  '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
  'scheduled'
);

INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
VALUES (
  'ffffffff-6666-6666-6666-666666666666',
  NULL,
  'refill',
  1,
  'pill',
  'seed'
);

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '12121212-7777-7777-7777-777777777777',
  'eeeeeeee-5555-5555-5555-555555555555',
  'manual',
  'debit',
  'Allowlist Account',
  'RUB'
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.email', 'allowlist-pass@example.com', true);

SELECT ok(
  EXISTS (SELECT 1 FROM public.persons WHERE id = 'eeeeeeee-5555-5555-5555-555555555555'),
  'allowlisted user can read target persons row'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.med_regimens WHERE id = 'ffffffff-6666-6666-6666-666666666666'),
  'allowlisted user can read target med_regimens row'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.med_dose_events WHERE id = 'abababab-8888-8888-8888-888888888888'),
  'allowlisted user can read target med_dose_events row'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.med_inventory_transactions
    WHERE regimen_id = 'ffffffff-6666-6666-6666-666666666666'
      AND note = 'seed'
  ),
  'allowlisted user can read target med_inventory_transactions row'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.money_accounts WHERE id = '12121212-7777-7777-7777-777777777777'),
  'allowlisted user can read target money_accounts row'
);

SELECT set_config('request.jwt.claim.email', 'allowlist-deny@example.com', true);

SELECT is(
  (SELECT count(*) FROM public.persons WHERE id = 'eeeeeeee-5555-5555-5555-555555555555'),
  0::bigint,
  'non-allowlisted user cannot read target persons row'
);
SELECT is(
  (SELECT count(*) FROM public.med_regimens WHERE id = 'ffffffff-6666-6666-6666-666666666666'),
  0::bigint,
  'non-allowlisted user cannot read target med_regimens row'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE id = 'abababab-8888-8888-8888-888888888888'),
  0::bigint,
  'non-allowlisted user cannot read target med_dose_events row'
);
SELECT is(
  (SELECT count(*) FROM public.money_accounts WHERE id = '12121212-7777-7777-7777-777777777777'),
  0::bigint,
  'non-allowlisted user cannot read target money_accounts row'
);

SELECT throws_ok(
  $$
    INSERT INTO public.money_accounts (
      owner_person_id,
      source,
      account_kind,
      account_label,
      currency
    )
    VALUES (
      'eeeeeeee-5555-5555-5555-555555555555',
      'manual',
      'debit',
      'Denied Account',
      'RUB'
    )
  $$,
  'new row violates row-level security policy for table "money_accounts"',
  'non-allowlisted user cannot insert into money_accounts'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
