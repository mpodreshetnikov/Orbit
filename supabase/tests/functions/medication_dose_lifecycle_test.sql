BEGIN;
SELECT plan(19);

SELECT has_function('public', 'mark_dose_taken', ARRAY['uuid', 'text', 'timestamp with time zone']);
SELECT has_function('public', 'mark_dose_skipped', ARRAY['uuid', 'text']);
SELECT has_function('public', 'undo_dose_intake', ARRAY['uuid']);
SELECT has_function('public', 'snooze_dose', ARRAY['uuid', 'uuid', 'integer']);
SELECT has_function(
  'public',
  'update_dose_event_resolution_details',
  ARRAY['uuid', 'timestamp with time zone', 'numeric', 'text']
);
SELECT has_function('public', 'update_regimen_inventory', ARRAY['uuid', 'text', 'numeric', 'text']);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'dose-owner@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'dose-caregiver@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Dose Person',
  'human',
  '11111111-1111-1111-1111-111111111111'
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
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Amoxicillin',
  '{"mode":"daily_times","times":["09:00"],"amounts":[2]}'::jsonb,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":2,"unit":"pill"},"active":[]}'::jsonb,
  '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":10,"refill_threshold_amount":2,"unit":"pill"}'::jsonb
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
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  now() + interval '1 hour',
  now() + interval '1 hour',
  '{"intake":{"amount":2,"unit":"pill"},"active":[]}'::jsonb,
  'scheduled'
);

SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

SELECT public.mark_dose_taken(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '  taken note  ',
  '2026-01-01 10:00:00+00'::timestamptz
);

SELECT is(
  (SELECT status::text FROM public.med_dose_events WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'taken',
  'mark_dose_taken switches status to taken'
);
SELECT is(
  (SELECT note FROM public.med_dose_events WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'taken note',
  'mark_dose_taken trims and stores note'
);
SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  8::numeric,
  'mark_dose_taken decrements regimen inventory'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.med_inventory_transactions
    WHERE regimen_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND type = 'decrement'
  ),
  1::bigint,
  'mark_dose_taken writes decrement inventory transaction'
);

SELECT public.update_dose_event_resolution_details(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  NULL,
  1,
  ' edited note '
);

SELECT is(
  (
    SELECT (planned_intake->'intake'->>'amount')::numeric
    FROM public.med_dose_events
    WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  1::numeric,
  'update_dose_event_resolution_details rewrites taken amount'
);
SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  9::numeric,
  'update_dose_event_resolution_details rebalances inventory after amount edit'
);

SELECT public.mark_dose_skipped('cccccccc-cccc-cccc-cccc-cccccccccccc', ' skipped ');

SELECT is(
  (SELECT status::text FROM public.med_dose_events WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'skipped',
  'mark_dose_skipped transitions event to skipped'
);
SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  10::numeric,
  'mark_dose_skipped restores inventory when reverting a taken dose'
);

SELECT public.undo_dose_intake('cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT is(
  (SELECT status::text FROM public.med_dose_events WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'scheduled',
  'undo_dose_intake returns event to scheduled'
);

INSERT INTO public.notification_routing (recipient_user_id, person_id, enabled, custom_prefix)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  true,
  'Dose Kid'
);

SELECT public.snooze_dose(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '22222222-2222-2222-2222-222222222222',
  30
);

SELECT is(
  (SELECT status::text FROM public.med_dose_events WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'snoozed',
  'snooze_dose sets event status to snoozed'
);
SELECT is(
  (
    SELECT payload_json->>'title_prefix'
    FROM public.notification_digests
    WHERE auth_user_id = '22222222-2222-2222-2222-222222222222'
      AND person_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND type = 'medication_snoozed'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'Dose Kid',
  'snooze_dose creates digest payload with routing prefix for caregiver'
);

SELECT public.update_regimen_inventory(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'refill',
  5,
  ' restock '
);

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  15::numeric,
  'update_regimen_inventory refill increases current amount'
);
SELECT is(
  (
    SELECT type::text || ':' || amount::text || ':' || coalesce(note, '')
    FROM public.med_inventory_transactions
    WHERE regimen_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND type = 'refill'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'refill:5:restock',
  'update_regimen_inventory writes refill transaction with normalized note'
);

SELECT * FROM finish();
ROLLBACK;
