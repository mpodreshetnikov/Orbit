# Health MCP Server

## Purpose And Intent

Before this change, every piece of health data in this app could only be reached by opening the web
UI in a browser. Someone who wanted to log their weight had to navigate to the measurements page and
fill a dialog; someone who wanted to know what their last blood panel said about ferritin had to
find the record and read it.

After this change the app exposes its Health domain over MCP (Model Context Protocol), a standard
way for an AI assistant to call an application's functions. A user adds one URL to their assistant
as a "custom connector", signs in with the same Google account the web app uses, approves a consent
screen, and can then say "log my weight at 78.4 kg", "what did my last blood panel say about
ferritin?", or "which checkups am I overdue for?" and have it work against their real data.

You can see it working by starting the app, connecting an MCP client to `http://127.0.0.1:3000/api/mcp`,
and asking it to list the people tracked in the health app — then adding a measurement through the
assistant and seeing the new row appear at `/health/measurements` in the browser.

## Terms

Terms used throughout, defined here so the rest reads plainly:

- **MCP** — Model Context Protocol. A JSON-RPC protocol an AI assistant speaks to call an
  application's functions ("tools"). Here it is served over HTTP at `/api/mcp`.
- **Tool** — one callable function exposed to the assistant, with a name, a description and a typed
  input schema. This change adds 23 of them.
- **RLS** — row-level security. Postgres evaluates a policy on every query to decide which rows the
  caller may see. In this app the policy on essentially every health table is
  `public.is_allowed_user()`, which checks whether the caller's user id or email appears in the
  `allowed_users` table.
- **PKCE** — Proof Key for Code Exchange. The OAuth extension that stops a stolen authorization code
  from being redeemed by anyone but the client that requested it.
- **Grant** — one issued access/refresh token pair, stored in `mcp_oauth_grants`.
- **Regimen** — this app's word for a medication course: what to take, how much, how often. Stored
  in `med_regimens`. The individual scheduled intakes it generates are `med_dose_events`.

## Orientation

The pieces and how they fit:

- `src/app/api/mcp/route.ts` is the endpoint an assistant talks to. It wraps a handler from the
  `mcp-handler` package in bearer-token auth.
- `src/lib/mcp/tools/*` registers the tools. `src/lib/mcp/health/*` holds the actual database
  queries, each taking a Supabase client as its first argument.
- `src/app/api/oauth/*` and `src/app/.well-known/*` are a small OAuth 2.1 authorization server. It
  exists because the assistant needs a way to obtain a token, and because the consent step needs to
  identify a real signed-in user.
- `src/lib/mcp/supabase-user-client.ts` is the security-critical join between the two: it turns a
  grant into a Supabase client that Postgres treats as the granting user.

Full design detail lives in `docs/design/domains/health/mcp-server.md`.

## Milestones

### M1 — Middleware routing and redirect fidelity

The app's auth middleware gates every route. Two things had to change before an OAuth flow could
work at all.

First, `updateSession()` in `src/lib/supabase-middleware.ts` built its login redirect from
`request.nextUrl.pathname` alone, discarding the query string. An OAuth authorization request
carries everything that matters — `client_id`, `code_challenge`, `state` — in the query, so a user
sent through login would return to a parameterless `/oauth/authorize` and the flow would die with no
useful error. The fix preserves `pathname + search`, and clears the inherited query from the cloned
URL so those parameters do not also leak onto `/login` itself.

Second, `/api/mcp` and the OAuth and discovery routes must never be redirected. An MCP client
discovers where to authenticate by reading the `WWW-Authenticate` header off a `401`; a `307` to
`/login` gives it nothing to work with. These paths now return early from the middleware before any
session work.

Run `just test-unit-node` and `just test-unit-web`. Acceptance: logged out,
`curl -si "localhost:3000/health?tab=x"` returns
`Location: /login?redirect=%2Fhealth%3Ftab%3Dx`.

### M2 — OAuth storage, crypto and discovery

Three tables (`mcp_oauth_clients`, `mcp_oauth_authorization_codes`, `mcp_oauth_grants`) in
`supabase/migrations/20260809120000_add_mcp_oauth_tables.sql`, with matching policy file
`supabase/db/policies/mcp_oauth.sql` wired into `supabase/db/03_policies.sql`.

All three have RLS enabled and **no policies at all**. That is not an omission: they hold bearer
tokens, so nothing reachable from a browser should be able to read them. Only the service role,
which bypasses RLS, touches them, and only from server routes.
`supabase/tests/policies/mcp_oauth_rls_test.sql` asserts the policy count stays zero, so a future
contributor "helpfully" adding one fails the build.

`src/lib/mcp/crypto.ts` holds the primitives: token generation and SHA-256 hashing (tokens are never
stored in plaintext), PKCE S256 verification, the consent-form HMAC, and the Supabase user JWT
minting described in M4.

Run `just db-run && just quality-db-test`. Acceptance: both discovery URLs return the documented
JSON, and `just supabase-local-artifacts-verify` is clean.

### M3 — The authorization server

`/api/oauth/register` implements dynamic client registration, so the assistant configures itself
from the URL alone. It is unauthenticated by necessity, and bounded instead: `MCP_SERVER_ENABLED`
gates it, redirect URIs must be https (or loopback), and there is a hard cap on how many clients can
exist.

`/oauth/authorize` is a **page**, not a route handler, and is deliberately left behind the auth
middleware. That means an unauthenticated visitor gets the app's normal Google login and allowlist
check for free, and arrives at the consent screen already identified. The consent form posts to
`/api/oauth/authorize/decision`, which mints an authorization code bound to the _session's_ user —
never to whatever the form claims.

The form's hidden fields are covered by an HMAC (`MCP_OAUTH_SIGNING_SECRET`), so editing them in
devtools invalidates the submission rather than escalating the grant.

`/api/oauth/token` handles both grants. Notable behaviours, each covered by a test:

- A replayed authorization code is rejected **and revokes whatever the first exchange issued** — a
  code presented twice means it leaked.
- Refresh rotates: issuing a new pair revokes the old one. Reusing an already-revoked refresh token
  revokes the whole chain descended from it.
- Codes are claimed with a conditional `UPDATE ... WHERE consumed_at IS NULL`, so two concurrent
  exchanges cannot both succeed.

Acceptance: a manual PKCE round trip with `curl` yields a bearer token; replay, expiry, wrong
verifier and mismatched redirect all return `invalid_grant`.

### M4 — MCP endpoint and the session bridge

The heart of the change. A grant stores only `auth_user_id` and `user_email` — no Supabase
credential at all. On each tool call the server mints a fresh five-minute HS256 JWT for that user and
queries through it, so Postgres evaluates RLS exactly as it does for that person in the browser.

Acceptance: an unauthenticated `tools/list` returns `401` with a `WWW-Authenticate` header naming
the protected-resource document; an authenticated one returns the tool list; `list_persons` returns
real rows.

### M5 and M6 — The tool surface

23 tools covering measurements, medical records, observations, diagnoses, findings, checkups, the
four reference catalogs, and medications. Reads and writes both, as scoped.

Two extractions were made so the tools and the UI cannot drift apart:

- `src/lib/regimen-mappers.ts` — the row mappers were stranded behind a `"use client"` directive in
  `src/hooks/use-regimens.ts` despite being pure. Re-implementing `rowToRegimen` server-side would
  have been a quiet way for an assistant to report a subtly different medication than the app shows.
  The hook re-exports them, so no call site changed.
- `src/lib/medications/regenerate-dose-events.ts` — extracted from
  `src/app/api/medications/regenerate-events/route.ts`. Any change to a regimen must regenerate its
  upcoming dose events or the app's "Today's intakes" keeps showing the old plan. The route's
  pre-existing test served as the characterization baseline and passes unchanged.

Acceptance: a measurement added through an assistant appears at `/health/measurements`; a medication
added through an assistant produces intakes on `/health/medications`.

### M7 — Documentation and gates

Design doc at `docs/design/domains/health/mcp-server.md`; security rules in `docs/SECURITY.md`;
runtime surface and domain maps in `docs/ARCHITECTURE.md`; local setup in `docs/SETUP.md`; two
entries in the tech-debt tracker.

## Progress

- [x] M1 — middleware routing and redirect fidelity
- [x] M2 — OAuth storage, crypto, discovery endpoints
- [x] M3 — registration, consent, token and revocation endpoints
- [x] M4 — MCP endpoint, token verification, session bridge
- [x] M5 — read tools
- [x] M6 — write tools and the two shared extractions
- [x] M7 — documentation and quality gates
- [ ] Manual end-to-end verification against a deployed instance with a real MCP client
- [ ] `just db-run` / `just db-test` / `just db-artifacts-refresh` on a machine with Docker

## Surprises And Discoveries

**Next.js resolves dot-prefixed app directories.** The discovery documents must live at
`/.well-known/...`, and it was not obvious that `src/app/.well-known/` would work rather than being
treated as a hidden directory. It does; `.next/app-path-routes-manifest.json` after a build shows
all three routes registered. No `next.config.ts` rewrite fallback was needed.

**The middleware's query-string bug was fatal, not cosmetic.** `request.nextUrl.clone()` keeps the
original query, while the code then set `redirect` to the pathname only. So the OAuth parameters
were simultaneously _lost_ from the redirect target and _leaked_ onto `/login`. Both halves needed
fixing.

**Copying the browser's Supabase refresh token would have signed users out of the web app.** The
first design stored the user's Supabase refresh token and refreshed it per request. GoTrue rotates
refresh tokens on every use with family-level reuse detection, so a stored copy from the browser's
family goes stale within the hour and replaying it revokes the family — logging the user out of the
web app as a side effect of a background tool call. Replaced with short-lived minted JWTs.

**`revokeGrantChain` on refresh rotation would have killed the token it just issued.** The new grant
records `rotated_from = <old grant id>`, and the chain revoker descends exactly that edge. Caught by
reading the code back before the test was written; the test now pins `revokeGrant` on the rotation
path and `revokeGrantChain` only on the reuse-detection path.

**A trend assertion failed for the right reason.** A test expected `"down"` from 79.0 → 78.4 and got
`"flat"`. The shared `getMeasurementTrend` helper has a documented 1% dead zone so noise does not
read as a trend, and 0.76% falls inside it. The test was wrong, not the code; the dead zone now has
its own explicit test.

**`measurement_catalog` has no synonym columns.** The other three catalogs have `synonyms_ru` and
`synonyms_en`; this one does not. A uniform search across all four would have thrown on it, so the
catalog spec carries a `hasSynonyms` flag.

## Decision Log

**MCP endpoint hosted in the Next.js app rather than a standalone stdio server.** A stdio server
would have been far simpler, but only works on the user's own machine with a desktop or CLI client.
Hosting it in the app means one URL works from web, mobile and desktop clients alike. Chosen with
the user.

**OAuth with dynamic client registration rather than a pasted API token.** A bearer token would have
been perhaps a fifth of the code, but browser-based connector dialogs have no field for a custom
header, so it would have ruled out exactly the clients this was built for. Chosen with the user.

**Minted short-lived Supabase JWTs rather than stored refresh tokens.** See Surprises. Verified
against the live project before committing: its legacy anon key is an HS256 JWT and is not disabled,
so the legacy JWT secret is active and PostgREST accepts tokens signed with it. Recorded here
because if that secret is ever revoked in favour of asymmetric-only signing, this design breaks and
the fallback is to mint an independent GoTrue session per grant via `admin.generateLink` +
`verifyOtp` (the mechanism `src/app/auth/dev-login/route.ts` already uses) and store _that_ family's
refresh token.

**User-scoped client for tool data, service role only for OAuth bookkeeping.** The app's RLS is
allowlist-based rather than owner-scoped (gap `ARCH-G05`), so in today's schema a service-role client
plus an explicit allowlist check would grant the same rows. It was still rejected: the user-scoped
design automatically inherits any future tightening of the policies, whereas the service-role design
would silently keep full access and become a privilege-escalation hole the day someone fixes
`ARCH-G05`.

**Token verification does one query and nothing else.** `withMcpAuth` converts any thrown error into
a `401`, which sends the client through the whole OAuth flow again. A transient database error must
not do that, so JWT minting and data access happen inside the tool handler where failures surface as
tool errors instead.

**A parallel server-side data layer rather than refactoring the client hooks.** The hooks are
`"use client"` and bound to the browser client and React Query; extracting their query bodies would
have meant touching ~8.6k lines of UI code and risking the entire Health UI for no user-visible
gain. The genuinely runtime-agnostic pieces are shared instead. Logged as debt.

**No deletion tools.** The request covered viewing, adding, searching and updating. Catalog rows are
foreign-key targets of live data and regimens use soft deletion with app-level semantics, so an
assistant able to delete could orphan rows in ways the UI prevents. Easy to add deliberately later.

**Person resolution accepts a name and falls back to the sole person.** Requiring `person_id`
everywhere would have forced a `list_persons` call before literally every operation. Ambiguity
returns the candidate list rather than an error, so the assistant asks instead of guessing which
family member was meant — which matters more than usual for medical data.

## Outcomes And Retrospective

Delivered: an MCP server mounted in the app with 23 Health tools, a complete OAuth 2.1 authorization
server bridging to the existing Google login, three new tables with a deny-all posture, and two
shared extractions that remove real drift risk between the assistant and the UI.

Verified here: 1317 unit tests pass across 210 files (about 190 of them new), typecheck and lint are
clean, and the production build registers all nine new routes. The MCP endpoint is exercised at the
HTTP level — an unauthenticated call returns the correct `401` challenge, an authenticated one
completes the handshake and lists the tools.

Not verified here, and the honest gap: this environment has no Docker, so the local Supabase stack
never ran. The migration has not been applied, `just db-test` has not run against a real database,
the generated artifacts (`supabase/db/schema.snapshot.sql`, `supabase/db/database.types.ts` and its
edge-function duplicate) have not been refreshed, and no real MCP client has completed the flow
end to end. Those are the first things to do on a machine with Docker.

Lesson worth carrying forward: the two most dangerous defects in this change — the refresh-token
family collision and the self-revoking rotation — were both invisible at the type level and would
have passed a superficial review. Both were caught by asking "what does this actually do on the
second call?" rather than by any tool.
