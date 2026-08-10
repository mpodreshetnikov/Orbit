# Health MCP Server

## Purpose

Exposes the Health domain to MCP (Model Context Protocol) clients so a user can drive the app
through an assistant: record a measurement by saying it, search their medical records, check what
screening they are overdue for, or adjust a medication course.

The server is mounted inside the Next.js app at `/api/mcp` and deploys with it. A user adds it in
their client as a custom connector by URL, signs in with the same Google account the web app uses,
and approves a consent screen.

Related: [`docs/SECURITY.md`](../../../SECURITY.md) for the trust model,
[`regimens-dose-events-and-reminders.md`](./regimens-dose-events-and-reminders.md) for what the
medication tools write.

## Surfaces

| Path                                              | Purpose                                                         |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `/api/mcp`                                        | MCP endpoint (streamable HTTP). Bearer auth, tools only.        |
| `/.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728 discovery. Both forms served; clients differ in which. |
| `/.well-known/oauth-authorization-server`         | RFC 8414 authorization server metadata.                         |
| `/api/oauth/register`                             | RFC 7591 dynamic client registration.                           |
| `/oauth/authorize`                                | Consent page. Session-gated, so it inherits login + allowlist.  |
| `/api/oauth/authorize/decision`                   | Consent form target; mints the authorization code.              |
| `/api/oauth/token`                                | Authorization-code and refresh-token grants.                    |
| `/api/oauth/revoke`                               | RFC 7009 revocation.                                            |

Everything 404s unless `MCP_SERVER_ENABLED=1`, so an unintended deployment cannot be registered as
a connector against real data.

## Why the authorize step is a page, not a route handler

`/oauth/authorize` is a React server component behind the app's normal auth middleware. An
unauthenticated visitor is redirected to `/login`, completes Google sign-in, is checked against
`allowed_users`, and lands back on the consent screen with the OAuth parameters intact. That reuses
the entire existing auth stack rather than reimplementing it.

This only works because the middleware preserves the query string when it redirects. It previously
kept only the pathname, which silently discarded `client_id`, `code_challenge` and `state` — fatal
for this flow. See `BEARER_AUTH_ROUTE_PREFIXES` and the `redirect` handling in
`src/lib/supabase-middleware.ts`.

The bearer-authenticated paths (`/api/mcp`, `/api/oauth/*`, `/.well-known/*`) return early from the
middleware before any session work. Without that, an unauthenticated MCP call would answer `307 ->
/login` instead of the `401` + `WWW-Authenticate` challenge a client needs in order to discover
where to authenticate.

## Session bridge: how RLS stays intact

This is the part worth understanding before changing anything.

A grant stores only `auth_user_id` and `user_email` — **no Supabase credential of any kind**. On
each tool call the server mints a fresh five-minute HS256 JWT with `sub`, `email`,
`role: "authenticated"` and `aud: "authenticated"`, signed with `SUPABASE_JWT_SECRET`, and builds a
Supabase client carrying it (`src/lib/mcp/supabase-user-client.ts`).

PostgREST then evaluates row-level security exactly as it does for that person in the browser,
because `public.is_allowed_user()` — the sole predicate on every health table — reads `auth.uid()`
and `auth.email()`, both of which come from that token. **The service-role key is never used for
health data.** It is used only by `src/lib/mcp/oauth-store.ts`, for the OAuth tables.

If you are tempted to reach for the service-role key inside a tool: don't. It bypasses RLS, and it
would silently fail to inherit any future tightening of the policies (see gap `ARCH-G05` in
[`docs/ARCHITECTURE.md`](../../../ARCHITECTURE.md)).

### Rejected alternative: copying the browser's Supabase refresh token

The obvious design — capture the user's Supabase refresh token at consent time and refresh it per
request — is unsafe here. GoTrue rotates refresh tokens on every use with family-level reuse
detection, so a stored copy from the browser's token family goes stale within the hour, and
replaying it revokes the family and **signs the user out of the web app**. Concurrent tool calls
would also race on the same rotation. Minting short-lived tokens avoids rotation, races, writes on
the read path, and any secret at rest.

The cost is that minted tokens are not revocable through GoTrue, so "sign out everywhere" does not
kill MCP access. Revocation is enforced on our side instead: every request reads the grant row and
checks `revoked_at`, `access_token_expires_at`, and live `allowed_users` membership.

## Auth failure vs infrastructure failure

`withMcpAuth` turns _any_ error thrown by the token verifier into a `401` challenge, which sends the
client off to re-run the whole OAuth dance. A momentary database blip must not do that.

So `verifyMcpBearerToken` does exactly one thing — a service-role lookup by token hash — and returns
`undefined` only for genuine auth failures: no token, unknown token, revoked, expired, or user no
longer allowlisted. JWT minting and all data access happen inside the tool handler, where failures
surface as tool errors the model can read and react to.

## Tool surface

23 tools, registered in `src/lib/mcp/tools/`. Data access lives in `src/lib/mcp/health/`, with each
function taking a `SupabaseClient` as its first argument so it can run under the caller's RLS.

- **Persons** — `list_persons`, `get_person`.
- **Measurements** — `list_measurements`, `get_measurement_history`, `add_measurement`.
- **Records and extractions** — `search_medical_records`, `get_medical_record`,
  `search_observations`, `get_observation_history`, `list_conditions`, `get_condition`,
  `search_findings`, `get_finding_history`.
- **Checkups** — `list_checkups`, `get_checkup`.
- **Catalogs** — `list_catalog_entries`, `search_catalog_entries`, `upsert_catalog_entry`.
- **Medications** — `list_medications`, `get_medication`, `list_medication_doses`,
  `add_medication`, `update_medication`.

Conventions that matter:

- Every person-scoped tool takes an optional `person_id` **and** `person_name`, and falls back to
  the sole person when the account has one. Ambiguity returns the candidate list rather than an
  error, so the assistant asks instead of guessing (`src/lib/mcp/resolve-person.ts`).
- Results carry both a short text summary (what the model reads) and `structuredContent` (what it
  chains into the next call). Dumping raw JSON into the text block roughly doubles token cost for
  no benefit.
- Write tools are annotated `readOnlyHint: false, destructiveHint: false`, **and require the
  `health:write` scope at dispatch** (`WRITE_SCOPE` in `src/lib/mcp/tools/scopes.ts`). The consent
  screen offers read and write separately and a client may register for read alone, so the check has
  to happen per call — an annotation alone would let a read-only token write, which would make the
  consent screen misleading. A test asserts the annotation and the scope stay in lockstep.
- Date-range tools take an optional `timezone` and resolve the saved preference, because the app's
  users are not in UTC and "what do I take today?" must mean the local day
  (`src/lib/mcp/local-day.ts`).
- **No deletion tools exist.** Catalog rows are foreign-key targets of live data, and regimens and
  conditions use soft deletion with app-level semantics.
- `add_medication` and `update_medication` must regenerate dose events, or the app's "Today's
  intakes" keeps showing the old plan. They call the same
  `@/lib/medications/regenerate-dose-events` the web route uses.

  PostgREST cannot wrap the regimen write and the regeneration in one transaction, and the web UI
  has the same two-step shape, so a regeneration failure leaves a saved regimen with stale
  reminders. Rather than surfacing a bare error — which reads as "nothing happened" and invites a
  retry of the whole operation — these tools report partial success explicitly: the medication is
  saved, the reminders are not, and re-running is safe because regeneration clears the future window
  before regenerating.

## Storage

Three tables, locked down two independent ways — RLS enabled with **no policies**, and table
privileges revoked from `anon` and `authenticated` outright. The revoke is the stronger layer: those
roles get `permission denied` (SQLSTATE 42501) rather than a silently filtered empty result. Only
`service_role`, which bypasses RLS and retains its grants, can reach them.

- `mcp_oauth_clients` — dynamically registered clients.
- `mcp_oauth_authorization_codes` — single-use, 60-second TTL, PKCE-bound.
- `mcp_oauth_grants` — issued access/refresh pairs, stored as SHA-256 hashes.

`supabase/tests/policies/mcp_oauth_rls_test.sql` asserts the policy count stays zero. If you think
you need a policy on these tables, you want a server route instead.

Security mechanics: PKCE S256 only (CHECK-constrained at the database level); exact-match
`redirect_uri` validation; an unknown client or unregistered redirect renders an error page rather
than redirecting, so the endpoint cannot be used as an open redirector; codes are single-use with
replay revoking whatever the first exchange issued; the consent form is covered by an HMAC so edited
hidden fields invalidate the submission.

Both single-use guards are conditional `UPDATE ... WHERE <still unused>` statements rather than
read-then-write, so concurrency cannot double-spend them. That matters most on refresh: two
simultaneous refreshes of the same token would otherwise both mint a replacement and leave two live
token families, defeating reuse detection. The loser of the race is treated as reuse and has its
chain revoked.

Registration is capped, but the cap counts _in-use_ registrations: abandoned ones (registered, never
used to complete a grant, older than a day) are pruned before a refusal. Without that, anyone could
submit enough registrations to the unauthenticated endpoint to permanently block new connectors.

## Environment

| Variable                    | Required  | Purpose                                                |
| --------------------------- | --------- | ------------------------------------------------------ |
| `MCP_SERVER_ENABLED`        | yes (`1`) | Master switch; every route 404s without it.            |
| `SUPABASE_JWT_SECRET`       | yes       | Mints the short-lived per-request user JWT.            |
| `MCP_OAUTH_SIGNING_SECRET`  | yes       | HMAC key for the consent token.                        |
| `SUPABASE_SERVICE_ROLE_KEY` | yes       | OAuth table access only.                               |
| `MCP_PUBLIC_ORIGIN`         | optional  | Overrides the detected origin; needed behind a tunnel. |

The issuer origin is otherwise derived from proxy headers, which is what Vercel sets. It must be
byte-identical across the discovery documents and the authorize/token URLs or clients reject the
metadata.

## Connecting a client

1. Set the environment variables above in the deployment.
2. In the MCP client, add a custom connector pointing at `https://<app-domain>/api/mcp`.
3. Complete Google sign-in and approve the consent screen.
4. The client registers itself automatically; nothing needs configuring by hand.

For local development a client that can reach `http://127.0.0.1:3000` (Claude Code, MCP Inspector)
works directly. For a browser-based client, put a tunnel in front of the dev server and set
`MCP_PUBLIC_ORIGIN` to the tunnel origin.
