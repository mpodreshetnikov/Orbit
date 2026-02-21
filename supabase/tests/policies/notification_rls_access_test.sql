BEGIN;
SELECT plan(7);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-1111-1111-1111-111111111111', 'rls-owner@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'rls-other@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES
  ('cccccccc-3333-3333-3333-333333333333', 'RLS Owner Person', 'human', 'aaaaaaaa-1111-1111-1111-111111111111'),
  ('dddddddd-4444-4444-4444-444444444444', 'RLS Other Person', 'human', 'bbbbbbbb-2222-2222-2222-222222222222');

INSERT INTO public.push_subscriptions (auth_user_id, endpoint, p256dh, auth)
VALUES (
  'aaaaaaaa-1111-1111-1111-111111111111',
  'https://example.com/sub/owner',
  'owner-p256dh',
  'owner-auth'
);

INSERT INTO public.notification_routing (recipient_user_id, person_id, enabled, custom_prefix)
VALUES (
  'aaaaaaaa-1111-1111-1111-111111111111',
  'cccccccc-3333-3333-3333-333333333333',
  true,
  'Owner Prefix'
);

INSERT INTO public.notification_digests (
  auth_user_id,
  person_id,
  type,
  scheduled_at,
  payload_json
)
VALUES (
  'aaaaaaaa-1111-1111-1111-111111111111',
  'cccccccc-3333-3333-3333-333333333333',
  'medication',
  now(),
  '{"title":"Owner digest","body":"test","url":"/"}'::jsonb
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-1111-1111-111111111111', true);

SELECT is(
  (SELECT count(*) FROM public.push_subscriptions),
  1::bigint,
  'owner can read own push subscriptions'
);
SELECT is(
  (SELECT count(*) FROM public.notification_routing),
  1::bigint,
  'owner can read own notification routing rows'
);
SELECT is(
  (SELECT count(*) FROM public.notification_digests),
  1::bigint,
  'owner can read own notification digests'
);

SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-2222-2222-2222-222222222222', true);

SELECT is(
  (SELECT count(*) FROM public.push_subscriptions),
  0::bigint,
  'non-owner cannot read another user push subscriptions'
);
SELECT is(
  (SELECT count(*) FROM public.notification_routing),
  0::bigint,
  'non-owner cannot read another user routing rows'
);
SELECT is(
  (SELECT count(*) FROM public.notification_digests),
  0::bigint,
  'non-owner cannot read another user digests'
);

SELECT throws_ok(
  $$
    INSERT INTO public.push_subscriptions (auth_user_id, endpoint, p256dh, auth)
    VALUES (
      'aaaaaaaa-1111-1111-1111-111111111111',
      'https://example.com/sub/forbidden',
      'forbidden-p256dh',
      'forbidden-auth'
    )
  $$,
  'new row violates row-level security policy for table "push_subscriptions"',
  'non-owner cannot insert subscription for another auth_user_id'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
