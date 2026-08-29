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
  `add_medication`, `log_dose`, `update_medication`.

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
- **A time this server quotes is converted and labelled, or it is not quoted.** Every timestamp
  rendered into a tool's text block goes through `src/lib/mcp/zoned-time.ts` and comes out as
  `2026-08-24 22:00 +07:00` — the caller's wall clock, carrying its offset — and the reply names the
  IANA zone it used. A date is the local calendar date, not `instant.slice(0, 10)`. In
  `structuredContent` the stored ISO instant stays exactly as it was and gains a `<field>_local`
  sibling, so anything already parsing these payloads keeps working.

  This is the output half of the same contract as the parsing rules below, and it was missing until
  `T-0027`. A course scheduled for 22:00 seven hours east of UTC is stored as `15:00+00:00`;
  `list_medication_doses` printed that instant with its offset sliced off, directly beneath a header
  naming the local zone, while `get_medication` returned those instants beside the regimen's own
  local wall-clock `schedule.times`. Two frames in one payload with nothing to tell them apart. An
  assistant asked to move the 22:00 dose reported that it "is at 15:00", refused, and asked the user
  to confirm — and the failure available to it next was worse: "correcting" the schedule by the
  offset through `update_medication`, which regenerates events and would have moved every future
  reminder of that course while reporting success.

  The zone comes from `readTimezonePreference`, never `resolveTimezone`, on read tools and on
  `log_dose` and `add_measurement` alike, and an unrecognised zone is refused rather than falling
  through to UTC. `log_dose` resolves it even when `taken_at` carries its own offset, because the
  confirmation quotes the time back and "logged at 15:00Z" is unreadable to the person who took the
  dose at ten in the evening.

- **What a tool's description promises, its text block delivers.** A read tool renders the fields
  its description names, not a subset — `list_medications` says "dose, active ingredients, schedule,
  course dates, stock and notes" and prints all six, and `get_medication` spells out the intakes and
  stock movements it counts rather than only counting them. The rule exists because the opposite
  shipped: the medication tools held the milligrams of every intake in
  `dose_definition.active` and `planned_intake.active`, returned them in `structuredContent`, and
  printed only "1.5 pill". Asked how long a dose had been at least 100 mg, an assistant reported
  that the record contained no milligrams at all and offered the owner a fork between 50 mg and
  100 mg tablets, while the row said 150 mg and the course note said «1.5 таб по 100 мг».
  A dose is rendered as `1.5 pill (Сертралин 150 milligram)`, in the units the row stores rather
  than abbreviations invented here, and an intake's `note` is printed so that "no note" is
  distinguishable from "notes are not returned". `schedule.times` are labelled as local wall clock,
  since they are plan strings rather than instants and the same reply quotes real instants in a
  named zone.

- **A list that cannot show everything says how to reach the rest, and pages in the query.** `list_medications` and
  `list_medication_doses` take `limit`/`offset` and answer with the window, the total, and the
  `offset` that continues it (`summarizePage` in `src/lib/mcp/tool-result.ts`). The previous
  "...and N more" tail named rows it gave no way to fetch, so past the twentieth medication the only
  route was guessing names into `search`. `list_medication_doses` also takes `regimen_id`: following
  one course's dose over time used to mean pulling every medication in the range and diffing by
  hand, which is how a titration history came to be reconstructed by binary search over 3–5 day
  windows.

  The page, the filters and the total all come from the database. PostgREST caps a response at
  `max_rows` (1000 in `supabase/config.toml`), so paging or filtering a result in memory would let a
  long history report its own truncation as the total and declare there was nothing further —
  strictly worse than the cursorless tail it replaced. Both queries also order by `id` after their
  natural sort, because neither `scheduled_at` nor `created_at` is unique: four courses of one
  medication were created in the same minute in production, and an unstable order under paging
  repeats one row while dropping another.

  A strength is printed only where it can be tied to the amount beside it. `active` is milligrams per
  intake with nothing recording what one unit contains, and nothing rescales it — the generator
  copies it while overriding a slot's amount, and `log_dose` keeps it when a caller corrects one. An
  intake whose amount differs from its course's therefore carries a total recorded for some other
  number of units, and reads `2 pill (strength not recorded for this amount)`. Naming the course's
  amount instead would not be safe either: `dose_definition` is edited in place and only future
  unresolved events are regenerated, so a past intake can sit beside a definition that moved under
  it. Until a per-unit strength exists, withholding the figure is the difference between reporting
  the record and inventing a dose.

  A name filter is a literal, not a pattern. `list_medications` matches with `imatch` (`~*`) over a
  regex-escaped needle rather than `ilike`: PostgREST rewrites `*` in a `like`/`ilike` value to `%`
  unconditionally, with no escape that survives the rewrite, so a name containing `*` would have
  turned a search into a wildcard and inflated the total beside it.

  Free text is bounded on its way into a text block. Notes have no length limit in the database and
  a page can carry a hundred of them, so each is flattened to one line and cut with an explicit `…`;
  `structuredContent` keeps the note itself.

- **No deletion tools exist.** Catalog rows are foreign-key targets of live data, and regimens and
  conditions use soft deletion with app-level semantics.
- **A medication a person is currently on is never created twice.** `add_medication` refuses when a
  regimen of the same person is still running under the same name — trimmed and lower-cased, the
  matcher `src/components/medications/medication-form.tsx` uses — and returns every match, finished
  courses included, so the caller can pick one. `allow_duplicate: true` overrides it for a second
  concurrent course or a genuinely separate medication that shares a name.

  Only `active` and `paused` courses block. A completed or archived one under the same name is the
  ordinary shape of a re-prescription — titration is recorded as successive courses — and blocking
  it left no right answer: `log_dose` would file today's intake against last year's course, and
  `update_medication` would overwrite the record of what that course actually was.

  This lives in the server rather than in an agent's prompt because the MCP is reachable from
  clients that never load this repository's skills. Before the guard, "she took half an Atarax
  tonight" had only one write available to it and produced a second medication standing beside the
  real course (`T-0018`).

- `log_dose` records one intake — planned or not — against an existing regimen, which is what that
  request should have reached for. It follows the web UI's `addOneTimeDoseToRegimen`
  (`src/hooks/use-regimens.ts`): insert the `med_dose_events` row, then resolve it through
  `mark_dose_taken` or `mark_dose_skipped`. Writing `status: 'taken'` straight into the insert would
  skip the RPC that records the inventory transaction and decrements stock. It deliberately does
  **not** regenerate dose events: logging an intake records history, it does not change the plan.

  **Saying it twice must not record it twice.** Where the UI reaches this path only for intakes
  _outside_ the plan, `log_dose` is the only way in, so it first looks for an existing event in the
  same regimen-minute — at _any_ status — and resolves that one instead of inserting beside it. The
  status filter is deliberately absent: `idx_med_dose_events_regimen_scheduled_minute` covers only
  `scheduled` and `sent`, so a dose the person ticked in the app is invisible to a status-filtered
  probe _and_ unblocked by the index, and logging it again would write a second intake and a second
  inventory decrement. `snoozed` is the same, and additionally leaves its `medication_snoozed`
  digest armed — a reminder for a dose already recorded. The RPCs are built for this:
  `mark_dose_taken` accepts `skipped` and `mark_dose_skipped` accepts `taken`, so a resolution is
  amended in place. A dose already carrying the requested status is reported back untouched.

  **A failed call must not destroy a good record.** `supabase.rpc` reports a lost response exactly
  like a rejected call, and the RPC is `plpgsql`: it may well have committed — status changed,
  inventory transaction written, stock decremented — with only the reply going missing. So the
  failure path re-reads the row before touching anything. If it comes back resolved, the write
  landed and the call succeeds. Only a row that reads back still unresolved, and only one this call
  inserted, is withdrawn; a planned event is left alone, since withdrawing it would delete part of
  the plan, and a corrected amount written onto it is put back. If the row cannot be read at all,
  nothing is touched and the response says the outcome is unknown — an unresolved event is a
  reminder too many, a deleted one may be a medical record too few.

  That withdrawal is a hard delete rather than a `deleted_at` stamp — the one place in this domain
  that removes a row outright. The index above is predicated on `status` alone, so a soft-deleted
  `scheduled` row still holds its regimen's minute while every reader hides it: the next attempt
  could neither see the tombstone nor insert past it, and that intake would be unrecordable for
  good. The row is seconds old and was never resolved, so there is no history to keep.

  **Amendments preserve what they do not change.** Correcting the amount spreads the existing
  `planned_intake` rather than rebuilding it, keeping the active ingredients the generator carries
  forward and the slot's own unit — the dose event is the only record of what was actually taken,
  and `mark_dose_taken` copies that unit straight into the inventory ledger.

  **The timezone is read, never written.** `resolveTimezone` _persists_ what it is handed into
  `user_preferences.checkup_notification_timezone`, which drives
  `run_med_event_generation_for_all_users` and both reminder digests. That is right for
  `add_medication` and `update_medication`, which are re-timing the plan, and wrong here: a timezone
  hint given to interpret one timestamp would silently move every future dose event and checkup
  reminder in the household. `log_dose` and `list_medication_doses` use `readTimezonePreference`
  instead, and an unrecognised zone is refused rather than quietly falling through to UTC.

  `taken_at` is parsed deliberately rather than through bare `new Date`: a string carrying an offset
  or `Z` is taken at face value, an offset-less wall-clock time is read in the caller's `timezone`
  (or the saved preference), and anything else is refused. That includes a date that does not exist,
  since `Date.parse` rolls `2026-02-30` forward to March 2 rather than failing, and a local time
  that does not exist in the zone — the hour a spring-forward skips, which the offset iteration
  would otherwise resolve to an instant an hour off, and in zones whose transition sits at midnight,
  onto the previous local day. An ambiguous fall-back time is accepted, settling on the later
  occurrence: unlike a gap it does exist, and either reading is at most an hour out. `new Date`
  would read an offset-less string in the _server's_ zone — UTC in production, so hours off for
  anyone else — and it also accepts non-ISO input like `"0"`. That parser is
  `instantFromInput` in `src/lib/mcp/zoned-time.ts`, and `add_measurement` uses it too:
  `measured_at` went into a `timestamptz` column exactly as handed in until `T-0027`, so an
  offset-less wall clock was stored as UTC — the same defect, on the tool most likely to be given a
  bare "yesterday evening" time.

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
