BEGIN;
SELECT plan(9);

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

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
