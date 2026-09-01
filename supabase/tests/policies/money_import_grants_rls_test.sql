BEGIN;
SELECT plan(20);

SELECT has_table('public', 'money_import_grants', 'money_import_grants table exists');

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.money_import_grants'::regclass
  ),
  'money_import_grants has row level security enabled'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_import_grants'
      AND policyname = 'money_import_grants_select'
  ),
  'money_import_grants_select policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_import_grants'
      AND policyname = 'money_import_grants_insert'
  ),
  'money_import_grants_insert policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_import_grants'
      AND policyname = 'money_import_grants_update'
  ),
  'money_import_grants_update policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_import_grants'
      AND policyname = 'money_import_grants_delete'
  ),
  'money_import_grants_delete policy exists'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('7d000000-0000-0000-0000-000000000001', 'money-grants-rls@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('7d000000-0000-0000-0000-000000000001', 'money-grants-rls@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('7d000000-0000-0000-0000-000000000010', 'Money Grants RLS Person', 'human');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-grants-rls@example.com', true);
SELECT set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-000000000001', true);

SELECT lives_ok(
  $$
    INSERT INTO public.money_import_grants (
      id,
      person_id,
      created_by_auth_user_id,
      label,
      token_hash,
      allowed_sources
    )
    VALUES (
      '7d000000-0000-0000-0000-000000000101',
      '7d000000-0000-0000-0000-000000000010',
      '7d000000-0000-0000-0000-000000000001',
      'Home laptop',
      'hash-money-grants-rls',
      ARRAY['tbank_web']
    )
  $$,
  'authenticated allowlisted users can create an import grant'
);

-- Revoking is the whole point of a long-lived credential: it must be reachable from the app.
SELECT lives_ok(
  $$
    UPDATE public.money_import_grants
    SET revoked_at = now()
    WHERE id = '7d000000-0000-0000-0000-000000000101'
  $$,
  'authenticated allowlisted users can revoke an import grant'
);

SELECT lives_ok(
  $$
    DELETE FROM public.money_import_grants
    WHERE id = '7d000000-0000-0000-0000-000000000101'
  $$,
  'authenticated allowlisted users can delete an import grant'
);

-- Everything above proves what the policies permit, and a policy of USING (true) would pass all
-- of it. These prove what they refuse, which is the half that matters for a table of long-lived
-- credentials.

-- The issuer is what resolveAuth re-checks against allowed_users on every use of a grant, so a
-- caller who could name someone else there could mint a credential that survives their own
-- removal by pointing at a person who stays.
SELECT throws_ok(
  $$
    INSERT INTO public.money_import_grants (
      person_id,
      created_by_auth_user_id,
      label,
      token_hash
    )
    VALUES (
      '7d000000-0000-0000-0000-000000000010',
      '7d000000-0000-0000-0000-0000000000ff',
      'Attributed to someone else',
      'hash-money-grants-rls-foreign-issuer'
    )
  $$,
  '42501',
  NULL,
  'a grant cannot be issued in another user''s name'
);

INSERT INTO public.money_import_grants (
  id,
  person_id,
  created_by_auth_user_id,
  label,
  token_hash,
  allowed_sources
)
VALUES (
  '7d000000-0000-0000-0000-000000000102',
  '7d000000-0000-0000-0000-000000000010',
  '7d000000-0000-0000-0000-000000000001',
  'Second laptop',
  'hash-money-grants-rls-2',
  ARRAY['tbank_web']
);

SELECT is(
  (SELECT count(*) FROM public.money_import_grants),
  1::bigint,
  'an allowlisted user sees the grant that exists'
);

-- Revoking stays open to the whole household on purpose, and that same UPDATE could otherwise
-- repoint the issuer at someone still allowed, restoring the credential the check above expires.
SELECT throws_ok(
  $$
    UPDATE public.money_import_grants
    SET created_by_auth_user_id = '7d000000-0000-0000-0000-0000000000ff'
    WHERE id = '7d000000-0000-0000-0000-000000000102'
  $$,
  NULL,
  'created_by_auth_user_id is fixed at issue time and cannot be changed',
  'the issuer of an existing grant cannot be changed'
);

-- Freezing the issuer alone is not enough. With the rest of the row writable, an allowlisted
-- user could take a still-allowed colleague's grant and swap in the hash of a token they hold:
-- the issuer is unchanged and still allowed, so the recheck passes and the hijacked token
-- outlives the attacker's own removal.
SELECT throws_ok(
  $$
    UPDATE public.money_import_grants
    SET token_hash = 'hash-of-a-token-the-caller-holds'
    WHERE id = '7d000000-0000-0000-0000-000000000102'
  $$,
  NULL,
  'token_hash is fixed at issue time; issue a new grant instead',
  'the secret of an existing grant cannot be swapped'
);

SELECT throws_ok(
  $$
    UPDATE public.money_import_grants
    SET person_id = '7d000000-0000-0000-0000-0000000000ee'
    WHERE id = '7d000000-0000-0000-0000-000000000102'
  $$,
  NULL,
  'person_id is fixed at issue time; issue a new grant instead',
  'a grant cannot be repointed at another person'
);

SELECT throws_ok(
  $$
    UPDATE public.money_import_grants
    SET allowed_sources = ARRAY['alfa_web']
    WHERE id = '7d000000-0000-0000-0000-000000000102'
  $$,
  NULL,
  'allowed_sources is fixed at issue time; issue a new grant instead',
  'the sources of an existing grant cannot be widened'
);

SELECT lives_ok(
  $$
    UPDATE public.money_import_grants
    SET revoked_at = now()
    WHERE id = '7d000000-0000-0000-0000-000000000102'
  $$,
  'revoking is still open to the household, which is the point of the update policy'
);

SELECT throws_ok(
  $$
    UPDATE public.money_import_grants
    SET revoked_at = NULL
    WHERE id = '7d000000-0000-0000-0000-000000000102'
  $$,
  NULL,
  'a revoked grant cannot be un-revoked; issue a new grant instead',
  'revocation is one-way'
);

SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*) FROM public.money_import_grants),
  0::bigint,
  'anon cannot read import grants'
);

SELECT throws_ok(
  $$
    INSERT INTO public.money_import_grants (
      person_id,
      created_by_auth_user_id,
      label,
      token_hash
    )
    VALUES (
      '7d000000-0000-0000-0000-000000000010',
      '7d000000-0000-0000-0000-000000000001',
      'Anonymous',
      'hash-money-grants-rls-anon'
    )
  $$,
  '42501',
  NULL,
  'anon cannot issue an import grant'
);

-- Signed in is not the same as allowed: a person with an auth account but no allowed_users row
-- must not see the household's credentials.
SET LOCAL ROLE postgres;

INSERT INTO auth.users (id, email, aud, role)
VALUES ('7d000000-0000-0000-0000-000000000002', 'money-grants-outsider@example.com', 'authenticated', 'authenticated');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-grants-outsider@example.com', true);
SELECT set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-000000000002', true);

SELECT is(
  (SELECT count(*) FROM public.money_import_grants),
  0::bigint,
  'a signed-in user who is not allowlisted cannot read import grants'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
