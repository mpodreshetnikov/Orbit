BEGIN;
SELECT plan(8);

SELECT has_function('public', 'link_allowed_user', ARRAY[]::text[]);
SELECT has_function('public', 'is_owner_of_person', ARRAY['uuid']);
SELECT has_function('public', 'update_updated_at_column', ARRAY[]::text[]);

INSERT INTO public.allowed_users (email)
VALUES ('link-owner@example.com');

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '12121212-3434-5656-7878-909090909090',
  'link-owner@example.com',
  'authenticated',
  'authenticated'
);

SELECT is(
  (
    SELECT auth_user_id::text
    FROM public.allowed_users
    WHERE email = 'link-owner@example.com'
  ),
  '12121212-3434-5656-7878-909090909090',
  'link_allowed_user trigger links auth_user_id on matching allowed_users email'
);

INSERT INTO public.allowed_users (email)
VALUES ('link-owner-case@example.com');

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '13131313-3434-5656-7878-909090909090',
  'Link-Owner-Case@Example.Com',
  'authenticated',
  'authenticated'
);

SELECT is(
  (
    SELECT auth_user_id::text
    FROM public.allowed_users
    WHERE email = 'link-owner-case@example.com'
  ),
  '13131313-3434-5656-7878-909090909090',
  'link_allowed_user trigger links auth_user_id with case-insensitive email match'
);

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '23232323-4545-6767-8989-010101010101',
  'Owned Person',
  'human',
  '12121212-3434-5656-7878-909090909090'
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', '12121212-3434-5656-7878-909090909090', true);
SELECT ok(
  public.is_owner_of_person('23232323-4545-6767-8989-010101010101'),
  'is_owner_of_person returns true for matching auth.uid and person.auth_user_id'
);

SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
SELECT ok(
  NOT public.is_owner_of_person('23232323-4545-6767-8989-010101010101'),
  'is_owner_of_person returns false for non-owner auth.uid'
);

RESET ROLE;

CREATE TEMP TABLE pgtap_updated_at_probe (
  id integer PRIMARY KEY,
  payload text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER pgtap_updated_at_probe_trigger
  BEFORE UPDATE ON pgtap_updated_at_probe
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO pgtap_updated_at_probe (id, payload, updated_at)
VALUES (1, 'initial', '2000-01-01 00:00:00+00');

UPDATE pgtap_updated_at_probe
SET payload = 'updated'
WHERE id = 1;

SELECT ok(
  (
    SELECT updated_at > '2000-01-01 00:00:00+00'::timestamptz
    FROM pgtap_updated_at_probe
    WHERE id = 1
  ),
  'update_updated_at_column trigger function replaces updated_at during updates'
);

SELECT * FROM finish();
ROLLBACK;
