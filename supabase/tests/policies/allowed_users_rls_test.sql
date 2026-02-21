BEGIN;
SELECT plan(2);

INSERT INTO public.allowed_users (email)
VALUES ('allowed-users-policy@example.com');

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.email', 'any-authenticated@example.com', true);

SELECT is(
  (
    SELECT count(*)
    FROM public.allowed_users
    WHERE email = 'allowed-users-policy@example.com'
  ),
  1::bigint,
  'authenticated users can read allowed_users rows via allowed_users_select policy'
);

SELECT throws_ok(
  $$
    INSERT INTO public.allowed_users (email)
    VALUES ('blocked-by-policy@example.com')
  $$,
  'new row violates row-level security policy for table "allowed_users"',
  'authenticated users cannot insert into allowed_users without a policy'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
