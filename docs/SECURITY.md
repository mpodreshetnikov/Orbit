# Security

## Access Model

- App access is allowlist-gated via `public.allowed_users`.
- Middleware enforces auth + allowlist checks before protected routes.
- Database access is RLS-first; policy files live in `supabase/db/policies/`.

Current expectation:

- If a table stores app data, it must have explicit RLS policies and should rely on `public.is_allowed_user()` and/or ownership checks.

## Secrets

Do not commit secrets. Use environment variables and Supabase/Vercel secret stores.

Common variables used by this repo:

- Web:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
  - `NEXT_PUBLIC_EXTENSION_ID`
- Server/API:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DATABASE_URL` (for remote DB deploy script)
  - `MCP_SERVER_ENABLED` (master switch for the MCP connector; all its routes 404 without it)
  - `SUPABASE_JWT_SECRET` (mints short-lived user JWTs for MCP tool calls)
  - `MCP_OAUTH_SIGNING_SECRET` (HMAC key protecting the MCP consent form)
  - `MCP_PUBLIC_ORIGIN` (optional issuer override when proxy headers are unreliable)
- Supabase Edge Functions:
  - `OPENROUTER_API_KEY`
  - `WHO_ICD_CLIENT_ID`
  - `WHO_ICD_CLIENT_SECRET`
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `MONEY_FX_SYNC_TOKEN` (shared secret the `money-fx-sync` function requires; the same
    value is stored in Supabase Vault as `money_fx_sync_token` so the `pg_cron` job can
    present it)
- GitHub Actions deploy pipeline (`.github/workflows/main.yml`):
  - Secrets: `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASS`
  - Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_PROJECT_REF`

## Service Role Boundaries

- Service-role credentials are allowed only in server contexts (Next API routes, Edge Functions, deploy scripts).
- Never expose service-role keys to client bundles.
- Functions with `verify_jwt = false` must validate bearer tokens manually unless they are strictly internal cron-style endpoints. "Internal" means unreachable from the internet — a cron-triggered function on a public URL still needs a manual check, because the schedule does not restrict who else can call it.

## MCP Connector

The MCP server at `/api/mcp` lets an external assistant read and write Health data on a user's
behalf. Design detail lives in `docs/design/domains/health/mcp-server.md`; the security-relevant
rules are:

- **Tool data access is user-scoped, never service-role.** Each tool call mints a five-minute HS256
  JWT for the granting user and queries through it, so RLS evaluates exactly as it does in the
  browser. The service-role key is used only for the OAuth bookkeeping tables. A tool that reaches
  for the service-role key is a bug: it bypasses RLS and would not inherit future policy tightening.
- **`SUPABASE_JWT_SECRET` has service-role-equivalent blast radius** — it can mint a token for any
  user. Server-only; it must never reach a client bundle or a `NEXT_PUBLIC_` variable.
- **`mcp_oauth_clients`, `mcp_oauth_authorization_codes` and `mcp_oauth_grants` are locked down two
  ways, deliberately:** RLS enabled with zero policies, and table privileges revoked from `anon` and
  `authenticated`, so those roles are refused outright rather than reading a filtered empty result.
  Adding a policy or re-granting would expose bearer tokens to the browser;
  `supabase/tests/policies/mcp_oauth_rls_test.sql` fails on either.
- Tokens are stored only as SHA-256 hashes. Authorization codes are single-use with a 60-second TTL,
  and a replayed code revokes whatever the first exchange issued.
- Token lifetimes: access 30 days, refresh 180 days. Revocation is enforced per request against the
  grant row (`revoked_at`, expiry, and live `allowed_users` membership), because minted JWTs cannot
  be revoked through Supabase Auth.
- `MCP_SERVER_ENABLED` gates every MCP and OAuth route, so a preview or scratch deployment cannot be
  registered as a live connector.

## Storage And Sensitive Data

- Medical files are stored in private bucket `medical-attachments`.
- Access to storage objects is controlled by RLS policies in `supabase/db/policies/storage.sql`.
- Be explicit when data leaves Supabase (for example OCR/LLM providers); keep payloads minimal.

## DB Safety Rules

- No dashboard-only schema changes without a migration in `supabase/migrations/`.
- For policy/function/trigger/cron changes, update `supabase/db/` in the same change set when applicable.
- Avoid direct production SQL edits that are not committed to repo.

## Security Review Checklist For PRs

1. Any new table has RLS enabled and policies defined.
2. Any new API/Edge endpoint has explicit auth behavior. For MCP tools and OAuth routes, check them
   against the MCP Connector rules above.
3. No secrets are added to source, logs, or screenshots.
4. External API calls use least-privilege credentials and clear timeouts.
5. Migration and policy diffs are reviewed together.
