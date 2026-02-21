BEGIN;
SELECT plan(13);

SELECT has_function('public', 'clear_future_med_dose_events', ARRAY['uuid', 'integer']);
SELECT has_function('public', 'clear_future_med_dose_events_for_person', ARRAY['uuid', 'integer']);
SELECT has_function('public', 'generate_med_dose_events_for_person_ids', ARRAY['uuid[]', 'text', 'integer']);
SELECT has_function('public', 'generate_med_dose_events_for_horizon', ARRAY['uuid', 'text', 'integer']);
SELECT has_function('public', 'generate_med_dose_events_for_horizon_for_person', ARRAY['uuid', 'text', 'integer']);
SELECT has_function('public', 'run_med_event_generation_for_all_users', ARRAY['integer']);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('55555555-5555-5555-5555-555555555555', 'gen-owner@example.com', 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'gen-other@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '11111111-aaaa-bbbb-cccc-111111111111',
  'Generator Person',
  'human',
  '55555555-5555-5555-5555-555555555555'
);

INSERT INTO public.user_preferences (auth_user_id, checkup_notification_timezone, overdue_reminder_interval_minutes)
VALUES ('55555555-5555-5555-5555-555555555555', 'UTC', 30);

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
  '22222222-aaaa-bbbb-cccc-222222222222',
  '11111111-aaaa-bbbb-cccc-111111111111',
  'Generator Regimen',
  '{"mode":"interval_hours","interval":{"every":6},"amount":1}'::jsonb,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
  '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":1,"refill_threshold_amount":2,"unit":"pill"}'::jsonb
);

SELECT ok(
  public.generate_med_dose_events_for_person_ids(
    ARRAY['11111111-aaaa-bbbb-cccc-111111111111'::uuid],
    'UTC',
    2
  ) > 0,
  'generate_med_dose_events_for_person_ids creates future dose events'
);

SELECT ok(
  public.clear_future_med_dose_events_for_person('11111111-aaaa-bbbb-cccc-111111111111', 2) > 0,
  'clear_future_med_dose_events_for_person removes generated future events'
);

SELECT ok(
  public.generate_med_dose_events_for_horizon_for_person('11111111-aaaa-bbbb-cccc-111111111111', 'UTC', 2) > 0,
  'generate_med_dose_events_for_horizon_for_person regenerates events for one person'
);

SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
SELECT throws_ok(
  $$SELECT public.clear_future_med_dose_events('55555555-5555-5555-5555-555555555555', 2)$$,
  'Not authorized to clear events for another user',
  'clear_future_med_dose_events rejects authenticated user clearing other user events'
);

SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);

SELECT ok(
  public.clear_future_med_dose_events('55555555-5555-5555-5555-555555555555', 2) >= 0,
  'clear_future_med_dose_events runs for the owner auth user'
);

SELECT ok(
  public.generate_med_dose_events_for_horizon('55555555-5555-5555-5555-555555555555', 'UTC', 2) > 0,
  'generate_med_dose_events_for_horizon generates events from owner user id'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.run_med_event_generation_for_all_users(2) AS r
    WHERE r.auth_user_id = '55555555-5555-5555-5555-555555555555'
  ),
  'run_med_event_generation_for_all_users returns row for user with active regimen'
);

SELECT * FROM finish();
ROLLBACK;
