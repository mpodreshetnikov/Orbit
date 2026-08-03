BEGIN;
SELECT plan(8);

SELECT has_function('public', 'get_medication_refill_snooze', ARRAY['uuid']);
SELECT has_function('public', 'set_medication_refill_snooze', ARRAY['uuid', 'date']);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('55555555-5555-5555-5555-555555555555', 'refill-owner@example.com', 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'refill-caregiver@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '77777777-7777-7777-7777-777777777777',
  'Refill Person',
  'human',
  '55555555-5555-5555-5555-555555555555'
);

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
  '88888888-8888-8888-8888-888888888888',
  '77777777-7777-7777-7777-777777777777',
  'Refill Test Regimen',
  '{"mode":"daily_times","times":["09:00"],"amounts":[1]}'::jsonb,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
  '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":1,"refill_threshold_amount":2,"unit":"pill"}'::jsonb
);

INSERT INTO public.notification_routing (recipient_user_id, person_id, enabled, custom_prefix)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777',
  true,
  'Caregiver Prefix'
);

INSERT INTO public.user_preferences (auth_user_id, checkup_notification_timezone, overdue_reminder_interval_minutes)
VALUES
  ('55555555-5555-5555-5555-555555555555', 'UTC', 15),
  ('66666666-6666-6666-6666-666666666666', 'UTC', 15);

SELECT public.create_medication_refill_digests('66666666-6666-6666-6666-666666666666');

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE auth_user_id = '66666666-6666-6666-6666-666666666666'
      AND type = 'medication_refill'
      AND (payload_json->>'regimen_id') = '88888888-8888-8888-8888-888888888888'
      AND sent_at IS NULL
  ),
  1::bigint,
  'create_medication_refill_digests creates caregiver refill digest for the target regimen before snooze'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);

-- Must stay in the future relative to the run: a snooze whose date has passed
-- no longer suppresses digests, so a hardcoded date silently rots the
-- "skips caregiver while snoozed" assertion below into a failure once it lapses.
SELECT public.set_medication_refill_snooze(
  '88888888-8888-8888-8888-888888888888',
  (CURRENT_DATE + 30)
);

SELECT is(
  public.get_medication_refill_snooze('88888888-8888-8888-8888-888888888888'),
  (CURRENT_DATE + 30),
  'get_medication_refill_snooze returns the saved date for the current recipient'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE auth_user_id = '66666666-6666-6666-6666-666666666666'
      AND type = 'medication_refill'
      AND (payload_json->>'regimen_id') = '88888888-8888-8888-8888-888888888888'
      AND sent_at IS NULL
  ),
  0::bigint,
  'set_medication_refill_snooze dismisses existing unsent refill digests for the current recipient'
);

RESET ROLE;

SELECT is(
  public.create_medication_refill_digests('66666666-6666-6666-6666-666666666666'),
  0,
  'create_medication_refill_digests skips caregiver while snoozed'
);

SELECT public.create_medication_refill_digests('55555555-5555-5555-5555-555555555555');

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE auth_user_id = '55555555-5555-5555-5555-555555555555'
      AND type = 'medication_refill'
      AND (payload_json->>'regimen_id') = '88888888-8888-8888-8888-888888888888'
      AND sent_at IS NULL
  ),
  1::bigint,
  'create_medication_refill_digests still creates owner digest for the target regimen while caregiver snoozed'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);

SELECT public.set_medication_refill_snooze(
  '88888888-8888-8888-8888-888888888888',
  NULL
);

SELECT ok(
  public.get_medication_refill_snooze('88888888-8888-8888-8888-888888888888') IS NULL,
  'set_medication_refill_snooze clears the snooze when passed null'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
