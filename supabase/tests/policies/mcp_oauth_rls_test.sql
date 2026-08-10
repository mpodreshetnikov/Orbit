BEGIN;
SELECT plan(12);

-- The MCP OAuth tables hold bearer-token material for the Health tools. They
-- are service-role only, locked down two independent ways: RLS is enabled with
-- deliberately no policies, AND the table privileges are revoked from anon and
-- authenticated outright. The revoke is the stronger of the two -- those roles
-- get "permission denied" rather than a silently filtered empty result -- so
-- these assertions check both layers.

INSERT INTO auth.users (id, email, aud, role)
VALUES ('33333333-3333-3333-3333-333333333333', 'mcp-oauth@example.com', 'authenticated', 'authenticated');

INSERT INTO public.mcp_oauth_clients (client_id, client_name, redirect_uris)
VALUES ('mcp_test_client', 'Test Connector', ARRAY['https://claude.ai/api/mcp/auth_callback']);

INSERT INTO public.mcp_oauth_authorization_codes (
  code_hash, client_id, auth_user_id, user_email, redirect_uri, scope,
  code_challenge, expires_at
)
VALUES (
  'code-hash-1', 'mcp_test_client', '33333333-3333-3333-3333-333333333333',
  'mcp-oauth@example.com', 'https://claude.ai/api/mcp/auth_callback',
  'health:read health:write', 'challenge-1', now() + interval '1 minute'
);

INSERT INTO public.mcp_oauth_grants (
  client_id, auth_user_id, user_email, scope,
  access_token_hash, access_token_expires_at
)
VALUES (
  'mcp_test_client', '33333333-3333-3333-3333-333333333333',
  'mcp-oauth@example.com', 'health:read health:write',
  'access-hash-1', now() + interval '30 days'
);

-- Layer 1: RLS is enabled on all three tables.
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mcp_oauth_clients'::regclass),
  true,
  'RLS is enabled on mcp_oauth_clients'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mcp_oauth_authorization_codes'::regclass),
  true,
  'RLS is enabled on mcp_oauth_authorization_codes'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mcp_oauth_grants'::regclass),
  true,
  'RLS is enabled on mcp_oauth_grants'
);

-- No policies at all: this is the assertion that catches someone "helpfully"
-- adding one later, which would expose bearer tokens to the browser.
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('mcp_oauth_clients', 'mcp_oauth_authorization_codes', 'mcp_oauth_grants')),
  0::bigint,
  'MCP OAuth tables have no RLS policies (service-role access only)'
);

-- Layer 2: the app roles hold no table privileges at all.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.mcp_oauth_clients', 'SELECT'),
  'authenticated cannot select from mcp_oauth_clients'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.mcp_oauth_authorization_codes', 'SELECT'),
  'authenticated cannot select from mcp_oauth_authorization_codes'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.mcp_oauth_grants', 'SELECT'),
  'authenticated cannot select from mcp_oauth_grants (bearer tokens stay server-side)'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.mcp_oauth_grants', 'INSERT'),
  'authenticated cannot insert into mcp_oauth_grants'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.mcp_oauth_grants', 'SELECT'),
  'anon cannot select from mcp_oauth_grants'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.mcp_oauth_clients', 'SELECT'),
  'anon cannot select from mcp_oauth_clients'
);

-- And the same thing observed at runtime, so the guarantee is demonstrated and
-- not merely inferred from the catalog.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
SELECT set_config('request.jwt.claim.email', 'mcp-oauth@example.com', true);

SELECT throws_ok(
  'SELECT count(*) FROM public.mcp_oauth_grants',
  '42501',
  'permission denied for table mcp_oauth_grants',
  'authenticated is refused outright when reading mcp_oauth_grants'
);

SELECT throws_ok(
  $$
    INSERT INTO public.mcp_oauth_clients (client_id, client_name, redirect_uris)
    VALUES ('mcp_rogue', 'Rogue', ARRAY['https://evil.example/cb'])
  $$,
  '42501',
  'permission denied for table mcp_oauth_clients',
  'authenticated is refused outright when registering an OAuth client directly'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
