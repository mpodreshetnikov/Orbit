BEGIN;
SELECT plan(13);

SELECT has_function('public', 'get_routed_persons_for_recipient', ARRAY['uuid']);
SELECT has_function(
  'public',
  'get_medication_dose_reminder_payload_for_person',
  ARRAY['uuid', 'timestamp with time zone', 'text']
);
SELECT has_function('public', 'create_medication_reminder_digests', ARRAY['timestamp with time zone']);
SELECT has_function('public', 'create_medication_refill_digests', ARRAY['uuid']);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'notif-owner@example.com', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'notif-caregiver@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'Notif Person',
  'human',
  '33333333-3333-3333-3333-333333333333'
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
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'Vitamin D',
  '{"mode":"daily_times","times":["12:00"],"amounts":[1]}'::jsonb,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
  '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":1,"refill_threshold_amount":2,"unit":"pill"}'::jsonb
);

INSERT INTO public.notification_routing (recipient_user_id, person_id, enabled, custom_prefix)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  true,
  'Care Prefix'
);

INSERT INTO public.user_preferences (auth_user_id, checkup_notification_timezone, overdue_reminder_interval_minutes)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'UTC', 15),
  ('44444444-4444-4444-4444-444444444444', 'UTC', 15);

INSERT INTO public.med_dose_events (
  id,
  person_id,
  regimen_id,
  scheduled_at,
  actual_at,
  planned_intake,
  status
)
VALUES
  (
    'f1111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '2026-02-01 12:00:00+00'::timestamptz,
    '2026-02-01 12:00:00+00'::timestamptz,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'
  ),
  (
    'f2222222-2222-2222-2222-222222222222',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '2026-02-01 10:00:00+00'::timestamptz,
    '2026-02-01 10:00:00+00'::timestamptz,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'sent'
  );

SELECT is(
  (
    SELECT count(*)
    FROM public.get_routed_persons_for_recipient('44444444-4444-4444-4444-444444444444')
  ),
  1::bigint,
  'caregiver sees exactly one routed person'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_routed_persons_for_recipient('33333333-3333-3333-3333-333333333333')
  ),
  1::bigint,
  'owner gets implicit own person route'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_medication_dose_reminder_payload_for_person(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      '2026-02-01 12:00:00+00'::timestamptz,
      'UTC'
    )
  ),
  2::bigint,
  'payload function returns both due and overdue events for the same day'
);

SELECT public.create_medication_reminder_digests('2026-02-01 12:00:00+00'::timestamptz);

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'medication'
      AND person_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ),
  2::bigint,
  'create_medication_reminder_digests writes one digest per recipient'
);

SELECT is(
  (
    SELECT jsonb_array_length(payload_json->'doses')
    FROM public.notification_digests
    WHERE type = 'medication'
      AND auth_user_id = '44444444-4444-4444-4444-444444444444'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  2,
  'caregiver reminder digest contains both dose events in payload.doses'
);

SELECT is(
  (
    SELECT payload_json->>'title_prefix'
    FROM public.notification_digests
    WHERE type = 'medication'
      AND auth_user_id = '44444444-4444-4444-4444-444444444444'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'Care Prefix',
  'caregiver reminder digest uses routing custom_prefix'
);

SELECT public.create_medication_reminder_digests('2026-02-01 12:00:00+00'::timestamptz);

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'medication'
      AND person_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ),
  2::bigint,
  'running create_medication_reminder_digests again does not duplicate unsent digests'
);

SELECT is(
  public.create_medication_refill_digests('33333333-3333-3333-3333-333333333333'),
  2,
  'create_medication_refill_digests creates one digest for caregiver and one implicit owner digest'
);

SELECT is(
  public.create_medication_refill_digests('33333333-3333-3333-3333-333333333333'),
  0,
  'create_medication_refill_digests is idempotent per regimen+recipient+day'
);

SELECT * FROM finish();
ROLLBACK;
