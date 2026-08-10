-- MCP connector OAuth 2.1 authorization server storage.
--
-- These tables back the OAuth flow that lets an MCP client (for example Claude
-- as a custom connector) obtain a bearer token for this app's Health tools.
-- They hold authorization state only -- never health data, and never a Supabase
-- credential. Access tokens are stored as SHA-256 hashes; the plaintext token
-- exists only in the response that hands it to the client.
--
-- Security posture: RLS is enabled with NO policies, so anon/authenticated can
-- reach nothing. Only the service role (which bypasses RLS) touches these
-- tables, and only from server-side route handlers. See docs/SECURITY.md.

-- ============================================================================
-- Registered clients (RFC 7591 dynamic client registration)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_name text,
  redirect_uris text[] NOT NULL,
  grant_types text[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'],
  response_types text[] NOT NULL DEFAULT ARRAY['code'],
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  scope text NOT NULL DEFAULT 'health:read health:write',
  client_uri text,
  logo_uri text,
  policy_uri text,
  tos_uri text,
  software_id text,
  software_version text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mcp_oauth_clients_redirect_uris_not_empty
    CHECK (array_length(redirect_uris, 1) >= 1),
  CONSTRAINT mcp_oauth_clients_redirect_uris_bounded
    CHECK (array_length(redirect_uris, 1) <= 5)
);

COMMENT ON TABLE public.mcp_oauth_clients IS
  'MCP connector OAuth clients registered via RFC 7591. Service-role only; RLS enabled with no policies by design.';

-- ============================================================================
-- Authorization codes (single-use, short TTL, PKCE-bound)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mcp_oauth_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 hex of the code. The code itself is never persisted.
  code_hash text NOT NULL UNIQUE,
  client_id text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL,
  user_email text NOT NULL,
  redirect_uri text NOT NULL,
  scope text NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  resource text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  -- Set when the code is exchanged, so a later replay can revoke what the
  -- first exchange issued (RFC 6749 section 4.1.2 replay defence).
  issued_grant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mcp_oauth_authorization_codes_s256_only
    CHECK (code_challenge_method = 'S256')
);

COMMENT ON TABLE public.mcp_oauth_authorization_codes IS
  'Single-use PKCE-bound OAuth authorization codes for the MCP connector. Service-role only; RLS enabled with no policies by design.';

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorization_codes_expires_at
  ON public.mcp_oauth_authorization_codes (expires_at);

-- ============================================================================
-- Issued grants (access + refresh token pairs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mcp_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  -- The Supabase auth user this grant acts as. No Supabase token is stored:
  -- each MCP request mints a short-lived JWT from these two columns so that
  -- Postgres RLS evaluates exactly as it does for the same user in the browser.
  auth_user_id uuid NOT NULL,
  user_email text NOT NULL,
  scope text NOT NULL,
  access_token_hash text NOT NULL UNIQUE,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_hash text UNIQUE,
  refresh_token_expires_at timestamptz,
  rotated_from uuid REFERENCES public.mcp_oauth_grants(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mcp_oauth_grants IS
  'Issued MCP connector access/refresh token pairs, stored as SHA-256 hashes. Service-role only; RLS enabled with no policies by design.';

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_auth_user_id
  ON public.mcp_oauth_grants (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_active_client
  ON public.mcp_oauth_grants (client_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_access_token_expires_at
  ON public.mcp_oauth_grants (access_token_expires_at);

-- ============================================================================
-- Lock down: RLS on, no policies, no direct grants to app roles.
-- ============================================================================
ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mcp_oauth_clients FROM anon, authenticated;
REVOKE ALL ON public.mcp_oauth_authorization_codes FROM anon, authenticated;
REVOKE ALL ON public.mcp_oauth_grants FROM anon, authenticated;
