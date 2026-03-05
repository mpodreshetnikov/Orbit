BEGIN;
SELECT plan(39);

SELECT has_function('public', 'generate_med_dose_events_for_person_ids', ARRAY['uuid[]', 'text', 'integer']);
SELECT has_function('public', 'generate_med_dose_events_for_horizon', ARRAY['uuid', 'text', 'integer']);
SELECT has_function('public', 'generate_med_dose_events_for_horizon_for_person', ARRAY['uuid', 'text', 'integer']);
SELECT has_function('public', 'run_med_event_generation_for_all_users', ARRAY['integer']);

SELECT set_config('request.jwt.claim.sub', '', true);

CREATE TEMP TABLE _vars AS
SELECT
  (now() AT TIME ZONE 'UTC')::date AS today_utc,
  ((now() AT TIME ZONE 'UTC')::date + 1) AS tomorrow_utc,
  ((extract(isodow FROM ((now() AT TIME ZONE 'UTC')::date + 1))::int) % 7) AS dow_tomorrow,
  to_char((now() + interval '2 hours') AT TIME ZONE 'UTC', 'HH24:MI') AS time_plus_2h,
  (now() + interval '6 hours') AS due_in_horizon,
  (now() - interval '1 day') AS due_in_past,
  (now() + interval '10 days') AS due_outside_horizon;

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'matrix-owner@example.com', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'matrix-secondary@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'matrix-other@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Matrix Person Primary', 'human', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Matrix Person Secondary', 'human', '33333333-3333-3333-3333-333333333333'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Matrix Other Person', 'human', '22222222-2222-2222-2222-222222222222'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'Matrix Ownerless Person', 'pet', NULL);

INSERT INTO public.user_preferences (auth_user_id, checkup_notification_timezone, overdue_reminder_interval_minutes)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'UTC', 30),
  ('33333333-3333-3333-3333-333333333333', 'Asia/Tokyo', 30),
  ('22222222-2222-2222-2222-222222222222', 'UTC', 30);

-- Status/deletion filter regimens.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '10000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Active Filter',
  'active',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array(v.time_plus_2h),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '10000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Paused Filter',
  'paused',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array(v.time_plus_2h),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '10000000-0000-0000-0000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Completed Filter',
  'completed',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array(v.time_plus_2h),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '10000000-0000-0000-0000-000000000004',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Archived Filter',
  'archived',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array(v.time_plus_2h),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition, deleted_at)
SELECT
  '10000000-0000-0000-0000-000000000005',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Deleted Filter',
  'active',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array(v.time_plus_2h),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb),
  now()
FROM _vars v;

-- one_off regimens.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '20000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix OneOff In Horizon',
  'active',
  jsonb_build_object('mode', 'one_off', 'due_at', v.due_in_horizon),
  jsonb_build_object('type', 'ongoing', 'start_date', v.today_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '20000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix OneOff Past',
  'active',
  jsonb_build_object('mode', 'one_off', 'due_at', v.due_in_past),
  jsonb_build_object('type', 'ongoing', 'start_date', v.today_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '20000000-0000-0000-0000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix OneOff Outside Horizon',
  'active',
  jsonb_build_object('mode', 'one_off', 'due_at', v.due_outside_horizon),
  jsonb_build_object('type', 'ongoing', 'start_date', v.today_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

-- interval_hours regimens.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '30000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Interval Hours Fallback',
  'active',
  jsonb_build_object('mode', 'interval_hours', 'interval', jsonb_build_object('every', 6), 'amount', 0),
  jsonb_build_object('type', 'ongoing', 'start_date', v.today_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 2, 'unit', 'ml'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '30000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Interval Hours Defaults',
  'active',
  jsonb_build_object('mode', 'interval_hours', 'interval', jsonb_build_object('every', 8)),
  jsonb_build_object('type', 'ongoing', 'start_date', v.today_utc::text),
  NULL
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '30000000-0000-0000-0000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Interval Hours Future Start',
  'active',
  jsonb_build_object('mode', 'interval_hours', 'interval', jsonb_build_object('every', 6), 'amount', 1),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

-- daily_times regimen with slot-specific amount patterns.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '40000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Daily Times Amounts',
  'active',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array('08:00', '20:00'),
    'amounts', jsonb_build_array(0, 3)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 2, 'unit', 'capsule'), 'active', '[]'::jsonb)
FROM _vars v;

-- days_of_week regimens.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '50000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Days Of Week Ongoing',
  'active',
  jsonb_build_object(
    'mode', 'days_of_week',
    'days_of_week', jsonb_build_array(v.dow_tomorrow),
    'times', jsonb_build_array('13:00'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.today_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '50000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Days Of Week Until Date',
  'active',
  jsonb_build_object(
    'mode', 'days_of_week',
    'days_of_week', jsonb_build_array(v.dow_tomorrow),
    'times', jsonb_build_array('14:00'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'until_date', 'start_date', v.today_utc::text, 'end_date', v.today_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

-- interval_days regimens.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '60000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Interval Days Fallback Time',
  'active',
  jsonb_build_object(
    'mode', 'interval_days',
    'interval', jsonb_build_object('every', 1),
    'time_of_day', '10:00'
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  NULL
FROM _vars v;

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '60000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Interval Days For Days',
  'active',
  jsonb_build_object(
    'mode', 'interval_days',
    'interval', jsonb_build_object('every', 1),
    'times', jsonb_build_array('11:00'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'for_days', 'start_date', v.tomorrow_utc::text, 'days', 1),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.med_regimens (
  id,
  person_id,
  custom_name,
  status,
  schedule,
  duration,
  dose_definition,
  created_at
)
VALUES (
  '60000000-0000-0000-0000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Interval Days Missing Start Date Anchor',
  'active',
  jsonb_build_object(
    'mode', 'interval_days',
    'interval', jsonb_build_object('every', 30),
    'times', jsonb_build_array('09:00'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing'),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb),
  now() - interval '7 days'
);

WITH gen AS (
  SELECT public.generate_med_dose_events_for_person_ids(
    ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid],
    'UTC',
    5
  ) AS inserted
)
SELECT ok((SELECT inserted FROM gen) > 0, 'generate_med_dose_events_for_person_ids inserts events');

SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '10000000-0000-0000-0000-000000000001') > 0,
  'active regimen generates events'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '10000000-0000-0000-0000-000000000002'),
  0::bigint,
  'paused regimen does not generate events'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '10000000-0000-0000-0000-000000000003'),
  0::bigint,
  'completed regimen does not generate events'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '10000000-0000-0000-0000-000000000004'),
  0::bigint,
  'archived regimen does not generate events'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '10000000-0000-0000-0000-000000000005'),
  0::bigint,
  'soft-deleted regimen does not generate events'
);

SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '20000000-0000-0000-0000-000000000001'),
  1::bigint,
  'one_off in horizon generates exactly one event'
);
SELECT is(
  (SELECT status::text FROM public.med_dose_events WHERE regimen_id = '20000000-0000-0000-0000-000000000001' LIMIT 1),
  'taken',
  'one_off event is inserted as taken'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '20000000-0000-0000-0000-000000000001'
      AND taken_at = scheduled_at
  ),
  'one_off event keeps taken_at equal to scheduled_at'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '20000000-0000-0000-0000-000000000002'),
  0::bigint,
  'one_off in the past does not generate event'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '20000000-0000-0000-0000-000000000003'),
  0::bigint,
  'one_off outside horizon does not generate event'
);
WITH gen AS (
  SELECT public.generate_med_dose_events_for_person_ids(
    ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid],
    'UTC',
    5
  ) AS inserted
)
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '20000000-0000-0000-0000-000000000001'),
  1::bigint,
  'one_off generation is idempotent on rerun'
)
FROM gen;

SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '30000000-0000-0000-0000-000000000001') > 0,
  'interval_hours generates events'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '30000000-0000-0000-0000-000000000001'
      AND (planned_intake->'intake'->>'amount')::numeric <> 2
  ),
  'interval_hours falls back to dose_definition amount when schedule amount is invalid'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '30000000-0000-0000-0000-000000000001'
      AND planned_intake->'intake'->>'unit' <> 'ml'
  ),
  'interval_hours keeps intake unit from dose_definition'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '30000000-0000-0000-0000-000000000002'
      AND (planned_intake->'intake'->>'amount')::numeric <> 1
  ),
  'interval_hours defaults amount to 1 when dose_definition and schedule amount are missing'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.med_dose_events e
    CROSS JOIN _vars v
    WHERE e.regimen_id = '30000000-0000-0000-0000-000000000003'
      AND (e.scheduled_at AT TIME ZONE 'UTC')::date < v.tomorrow_utc
  ),
  'interval_hours respects future duration.start_date'
);

SELECT ok(
  (
    SELECT count(*)
    FROM public.med_dose_events
    WHERE regimen_id = '40000000-0000-0000-0000-000000000001'
  ) >= 2
  AND (
    SELECT mod(count(*), 2)
    FROM public.med_dose_events
    WHERE regimen_id = '40000000-0000-0000-0000-000000000001'
  ) = 0,
  'daily_times generates events in configured two-slot cadence across horizon'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '40000000-0000-0000-0000-000000000001'
      AND to_char(scheduled_at AT TIME ZONE 'UTC', 'HH24:MI') = '08:00'
      AND (planned_intake->'intake'->>'amount')::numeric = 2
  ),
  'daily_times falls back to dose_definition amount for invalid slot amount'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '40000000-0000-0000-0000-000000000001'
      AND to_char(scheduled_at AT TIME ZONE 'UTC', 'HH24:MI') = '20:00'
      AND (planned_intake->'intake'->>'amount')::numeric = 3
  ),
  'daily_times uses explicit slot amount when provided'
);

SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '50000000-0000-0000-0000-000000000001') > 0,
  'days_of_week generates events for matching day'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '50000000-0000-0000-0000-000000000002'),
  0::bigint,
  'days_of_week respects until_date boundary'
);

SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '60000000-0000-0000-0000-000000000001') > 0,
  'interval_days generates events when times are omitted'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '60000000-0000-0000-0000-000000000001'
      AND to_char(scheduled_at AT TIME ZONE 'UTC', 'HH24:MI') = '10:00'
  ),
  'interval_days falls back to time_of_day when times are missing'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '60000000-0000-0000-0000-000000000001'
      AND (planned_intake->'intake'->>'amount')::numeric <> 1
  ),
  'interval_days defaults amount to 1 when no slot amount or dose_definition exists'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '60000000-0000-0000-0000-000000000002'),
  1::bigint,
  'interval_days with for_days=1 generates only one day of events'
);
SELECT is(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '60000000-0000-0000-0000-000000000003'),
  0::bigint,
  'interval_days without start_date uses stable anchor and does not re-anchor to today'
);

-- Wrapper coverage: generate for auth user and for one person.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '70000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Matrix Wrapper Horizon',
  'active',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array('07:00'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

SELECT ok(
  public.generate_med_dose_events_for_horizon('11111111-1111-1111-1111-111111111111', 'UTC', 3) > 0,
  'generate_med_dose_events_for_horizon generates events for owner persons'
);
SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '70000000-0000-0000-0000-000000000001') > 0,
  'horizon wrapper created events for owner person regimen'
);

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '70000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'Matrix Wrapper Person',
  'active',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array('18:00'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

SELECT ok(
  public.generate_med_dose_events_for_horizon_for_person('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'UTC', 3) > 0,
  'generate_med_dose_events_for_horizon_for_person generates events for one person'
);
SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '70000000-0000-0000-0000-000000000002') > 0,
  'person wrapper created events for newly added regimen'
);

-- Cron entry point over all users with active regimens.
INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '80000000-0000-0000-0000-000000000001',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  'Matrix Run All Users',
  'active',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array('09:00'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.tomorrow_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

INSERT INTO public.notification_routing (recipient_user_id, person_id, enabled, custom_prefix)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  true,
  'Ownerless Prefix'
);

INSERT INTO public.med_regimens (id, person_id, custom_name, status, schedule, duration, dose_definition)
SELECT
  '80000000-0000-0000-0000-000000000002',
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  'Matrix Ownerless Routed',
  'active',
  jsonb_build_object(
    'mode', 'daily_times',
    'times', jsonb_build_array('09:30'),
    'amounts', jsonb_build_array(1)
  ),
  jsonb_build_object('type', 'ongoing', 'start_date', v.today_utc::text),
  jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb)
FROM _vars v;

CREATE TEMP TABLE _run_all AS
SELECT *
FROM public.run_med_event_generation_for_all_users(2);

SELECT is(
  (
    SELECT count(*)
    FROM _run_all
    WHERE auth_user_id IN ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid)
  ),
  2::bigint,
  'run_med_event_generation_for_all_users returns one row per user with active regimens'
);
SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '80000000-0000-0000-0000-000000000001') > 0,
  'run_med_event_generation_for_all_users generated events for other user regimen'
);
SELECT ok(
  (SELECT count(*) FROM public.med_dose_events WHERE regimen_id = '80000000-0000-0000-0000-000000000002') > 0,
  'run_med_event_generation_for_all_users generated events for ownerless routed regimen'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.med_dose_events
    WHERE regimen_id = '80000000-0000-0000-0000-000000000002'
      AND to_char(scheduled_at AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') = '09:30'
  ),
  'ownerless routed regimen uses recipient timezone from user_preferences'
);

SELECT * FROM finish();
ROLLBACK;
