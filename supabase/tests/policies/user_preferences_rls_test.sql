BEGIN;
SELECT plan(5);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('12345678-1234-1234-1234-123456789012', 'prefs-owner@example.com', 'authenticated', 'authenticated'),
  ('21098765-4321-4321-4321-210987654321', 'prefs-other@example.com', 'authenticated', 'authenticated');

INSERT INTO public.user_preferences (
  auth_user_id,
  checkup_notification_timezone,
  overdue_reminder_interval_minutes
)
VALUES (
  '12345678-1234-1234-1234-123456789012',
  'UTC',
  20
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', '12345678-1234-1234-1234-123456789012', true);

SELECT is(
  (
    SELECT count(*)
    FROM public.user_preferences
    WHERE auth_user_id = '12345678-1234-1234-1234-123456789012'
  ),
  1::bigint,
  'owner can read own user_preferences row'
);

UPDATE public.user_preferences
SET overdue_reminder_interval_minutes = 45
WHERE auth_user_id = '12345678-1234-1234-1234-123456789012';

SELECT is(
  (
    SELECT overdue_reminder_interval_minutes
    FROM public.user_preferences
    WHERE auth_user_id = '12345678-1234-1234-1234-123456789012'
  ),
  45,
  'owner can update own user_preferences row'
);

SELECT set_config('request.jwt.claim.sub', '21098765-4321-4321-4321-210987654321', true);

SELECT is(
  (
    SELECT count(*)
    FROM public.user_preferences
    WHERE auth_user_id = '12345678-1234-1234-1234-123456789012'
  ),
  0::bigint,
  'non-owner cannot read another user_preferences row'
);

INSERT INTO public.user_preferences (
  auth_user_id,
  checkup_notification_timezone,
  overdue_reminder_interval_minutes
)
VALUES (
  '21098765-4321-4321-4321-210987654321',
  'UTC',
  10
);

SELECT is(
  (
    SELECT count(*)
    FROM public.user_preferences
    WHERE auth_user_id = '21098765-4321-4321-4321-210987654321'
  ),
  1::bigint,
  'user can insert own user_preferences row'
);

SELECT throws_ok(
  $$
    INSERT INTO public.user_preferences (
      auth_user_id,
      checkup_notification_timezone,
      overdue_reminder_interval_minutes
    )
    VALUES (
      '12345678-1234-1234-1234-123456789012',
      'UTC',
      5
    )
  $$,
  'new row violates row-level security policy for table "user_preferences"',
  'non-owner cannot insert user_preferences for another auth_user_id'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
