-- Policies for the MCP connector OAuth tables
--
-- Deliberately empty of policies. RLS is enabled on all three tables and no
-- policy grants access to `anon` or `authenticated`, so those roles can read
-- and write nothing. Every legitimate access happens through the service role
-- (which bypasses RLS) from server-side route handlers under
-- src/app/api/oauth/* and src/app/api/mcp.
--
-- Adding a policy here would expose OAuth tokens to the browser. If you think
-- you need one, you almost certainly want a server route instead. The pgTAP
-- test supabase/tests/policies/mcp_oauth_rls_test.sql asserts that the policy
-- count stays zero.

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mcp_oauth_clients FROM anon, authenticated;
REVOKE ALL ON public.mcp_oauth_authorization_codes FROM anon, authenticated;
REVOKE ALL ON public.mcp_oauth_grants FROM anon, authenticated;
