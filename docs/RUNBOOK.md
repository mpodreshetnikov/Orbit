# Runbook

## Environments

- Command source of truth: `just --list --unsorted`.
- Local all-in-one runtime: run `dev-ready` from `AGENTS.md`.
- Stop local runtime/services: run `dev-stop` from `AGENTS.md`.
- Local DB reset + deploy: run `db-reset` from `AGENTS.md`.
- Local CI-style gate: run `ci` from `AGENTS.md`.
- Production deploy path: GitHub Actions workflow `.github/workflows/main.yml` on push to `main` (Vercel production + Supabase production deploy).

Notes:

- GitHub Actions jobs run in environment `production`.
- Deploy jobs are gated by `secrets-scan` and `quality-gates`.
- Configure GitHub Actions Vercel values:
  - Secrets: `VERCEL_TOKEN`
  - Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- Configure GitHub Actions Supabase values:
  - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASEDBPASS`
  - Variables: `SUPABASE_PROJECT_REF`
- Configure GitHub Actions extension release values:
  - Secret: `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY`
  - Variables: `SUPABASE_PROJECT_REF` and either `NEXT_PUBLIC_APP_ORIGIN` or `NEXT_PUBLIC_APP_ORIGINS`
- Disable Vercel's automatic Git deploy integration if you want GitHub Actions to be the only deployment trigger.
- Command execution policy (including avoiding `npm run` for project workflows) is canonical in `docs/QUALITY.md`.
- MCP setup instructions are in `mcp/README.md`.
- Observability stack setup (local LGTM + cloud + MCP queries) is in `docs/observability/README.md`.

## Chrome Extension Release Operations

- Release source of truth: `browserExtension/manifest.json` `version`.
- Public storage contract:
  - bucket: `extension-releases`
  - artifact path: `releases/<version>/orbit-extension-<version>.zip`
  - latest metadata path: `latest.json`
- CI flow:
  - `quality-gates` fails if packaged extension files change without a manifest version bump.
  - `extension-release-bundle` runs when the manifest version changes and uploads the versioned ZIP + `latest.json` as a workflow artifact.
  - `publish-extension-release` runs only on `main` and uploads the prepared bundle to Supabase Storage.
- Local/manual operator flow:
  - run `extension-release-build`
  - inspect `.artifacts/extension-release/`
  - run `extension-release-publish`
- Required env for manual release commands:
  - `NEXT_PUBLIC_APP_ORIGIN` or `NEXT_PUBLIC_APP_ORIGINS`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- The production website reads the published metadata through `/api/extension-release/latest` and redirects downloads through `/api/extension-release/latest/download`.
- Consumer Chrome cannot be silently installed from an arbitrary website. The supported production UX is one-click download plus manual Chrome Developer Mode installation/update steps.

## Triage Checklist

1. Classify surface: web route, API route, Edge Function, DB/RPC/cron.
2. Confirm environment and commit SHA first.
3. Reproduce locally if possible.
4. Check recent DB migrations and `supabase/db` changes.
5. If DB schema/types drift is suspected, run `db-artifacts-verify` from `AGENTS.md`.
6. If DB lint failures occur, run `db-lint` from `AGENTS.md` (public schema warnings fail).
7. If DB function/policy behavior changed, run `db-test` from `AGENTS.md` (pgTAP suite under `supabase/tests`).
8. Decide whether the fix is app code, function code, SQL, or config/secrets.

## Observability Correlation Triage

When debugging bugs or failures in services that have observability (e.g. Loki, Tempo, or other log/trace/metrics backends), use the **issue-investigation** skill together with systematic-debugging to correlate logs and traces as part of root cause investigation.

Use this when debugging frontend -> edge function -> RPC workflows.

1. Start from logs in Loki and capture one concrete `trace_id` + `request_id`.
2. Open the same `trace_id` in Tempo.
3. Confirm expected spans exist in a single trace:
   - `web.edge_function.<operation>`
   - `web.supabase.rpc.<rpc_name>`
   - `edge.<function>.<step>`
4. If a hop is missing, inspect request headers for:
   - `traceparent`
   - `x-request-id`
5. Verify edge logs include `trace_id`, `span_id`, and `request_id` on important step events.
6. Before RCA, confirm edge telemetry ingestion is live for the same UTC window:
   - Loki: query both app and edge streams (for example, `service_name="orbit"` and `service_name="supabase-function"`).
   - Tempo: confirm traces exist for both `resource.service.name="orbit"` and `resource.service.name="supabase-function"`.
   - If edge streams are missing locally, verify `OBS_LOCAL_OTLP_HTTP_ENDPOINT` is set (default expected: `http://127.0.0.1:4318`) and restart `dev`.

Fast LogQL starter:

```logql
{service_name="orbit"} | json | trace_id!="" | request_id!=""
```

Fast TraceQL starter:

```traceql
{ resource.service.name = "orbit" && trace:id = "$trace_id" }
```

## Runtime-Split Test Triage

Use the smallest failing lane first:

- Web app unit tests: `test-unit-web`
- Extension unit tests: `test-unit-ext`
- Node/scripts unit tests: `test-unit-node`
- Supabase Edge Functions (Deno): `test-unit-functions`
- DB functions/policies (pgTAP): `db-test`

For full local verification before merge:

- `test-unit`
- `test-unit-coverage`
- `coverage-check`
- `test`
- `check`

## Supabase Function Coverage Gate Failures

When `coverage-check` fails on Supabase functions:

- Re-run `test-unit-coverage` first to refresh `.coverage/deno/lcov.info`.
- Re-run `coverage-check` and inspect `supabase-function-coverage-threshold` output to identify the failing function directory.
- Confirm that production files (non-`_shared`, non-test, non-`index.ts`) have deterministic unit tests for both success and error branches.
- Confirm tests do not rely on live internet calls; use mocked `fetch`/web-push responses for all external integrations.
- If branch numbers look unexpectedly low for a module, check for duplicate LCOV `SF` records and ensure the per-file merge logic in `scripts/just/supabase-function-coverage-threshold.cjs` is being used.

## Auth And Access Issues

Symptoms:

- Redirect loops to `/login`
- Access denied for expected users

Checks:

```sql
select id, email, auth_user_id, added_at
from public.allowed_users
where email = '<user-email>';
```

- Verify middleware behavior in `src/lib/supabase-middleware.ts`.
- Verify user session exists in Supabase Auth.

## Notifications And Cron Issues

Useful locations:

- UI debug page: `/settings/notifications-debug`
- API routes: `src/app/api/notifications/run-cron/route.ts`, `src/app/api/medications/run-cron/route.ts`
- Edge Function entrypoint: `supabase/functions/notifications-cron/index.ts`
- Edge Function handler logic: `supabase/functions/notifications-cron/handler.ts`

DB checks:

```sql
select jobid, jobname, schedule, active
from cron.job
order by jobname;
```

```sql
select jobid, status, start_time, end_time, return_message
from cron.job_run_details
order by start_time desc
limit 50;
```

```sql
select type, count(*) as unsent
from public.notification_digests
where sent_at is null
group by type
order by type;
```

If cron calls are failing, verify `project_url` exists in vault (local seed sets it for local):

```sql
select name
from vault.decrypted_secrets
where name = 'project_url';
```

## Medication Event Generation Issues

Key endpoint:

- `POST /api/medications/regenerate-events` in `src/app/api/medications/regenerate-events/route.ts`

Checks:

- Run regenerate endpoint for the affected user/person.
- Verify rows exist in `med_dose_events` for the next 7 days.
- Confirm timezone source (request body -> user preferences -> UTC fallback).

## OCR/LLM Pipeline Issues

Functions:

- `supabase/functions/health-ocr/handler.ts`
- `supabase/functions/health-structure/handler.ts`

Checks:

- Confirm required secrets are set (`OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- Confirm attachment exists in `medical-attachments` bucket.
- Check function logs for auth failures, timeout, or model/provider errors.

## Lint And Typecheck Gate Issues

Quality gate commands:

- `format-check`
- `lint`
- `types`

Supabase function-specific checks:

- run `lint-supabase` for Deno lint issues.
- run `types` (or `quality-typecheck-supabase-functions`) for `deno check` failures.
- if Deno fails on unresolved URL imports, confirm `supabase/functions/deno.json` imports are valid and cache is fresh (`deno cache` can help diagnose).
- if function requests fail with `worker boot error` and `Unsupported lockfile version`, run `functions-lock-refresh` from `AGENTS.md`, then rerun `functions-lock-check` and `types`.
- prefer `npm:` specifiers over CDN URLs when adding a third-party dependency to `supabase/functions/deno.json`. `supabase functions deploy` bundles every function on every deploy, so a CDN outage fails the deploy at its last step, after the migrations and `supabase/db/deploy.sql` have already been applied, and production runs the old functions against the new schema until a retry gets through. `npm:` resolves through the npm registry, which the toolchain already depends on.

## Money Import Issues

Function:

- `supabase/functions/money-import/handler.ts`

Checks:

- Verify auth mode (user bearer token or import session token).
- Inspect import session/batch tables for status and errors:
  - `money_import_sessions`
  - `money_import_batches`
  - `money_import_batch_rows`
- Verify upsert RPC behavior (`money_upsert_transactions_batch`).

### T-Bank Extension Scraper Debug (Local)

Use command IDs from `AGENTS.md`:

0. Generic source-parameterized commands (preferred for new connectors):
   - `extension-debug-live <source_id>`
   - `extension-debug-live-full <source_id>`
   - `extension-debug-analyze <source_id> [artifact_dir_or_file]`
   - `extension-debug-report <source_id> [artifact_dir_or_file]`
1. Run a live debug session:
   - `extension-debug-live tbank_web`
   - This launches a browser with the extension, opens the source target page, and runs an auth-state check first.
   - If the persisted Playwright session is already authenticated, parsing continues automatically with no manual step.
   - If login/challenge is detected, interactive runs prompt for manual completion; non-interactive runs fail fast with an actionable message.
   - Human-readable report artifacts are generated automatically after the run.
2. Analyze generated artifact:
   - `extension-debug-analyze tbank_web`
   - Or analyze explicit folder/file: `extension-debug-analyze tbank_web .tmp/scraper-debug/tbank/<timestamp>-<run_id>`
3. Re-render human-readable validation report (optional):
   - `extension-debug-report tbank_web`
   - Or for explicit folder/file: `extension-debug-report tbank_web .tmp/scraper-debug/tbank/<timestamp>-<run_id>`

Agent/self-verification flow (works when Playwright session is already logged in):

1. `extension-debug-live <source_id>`
2. `extension-debug-analyze <source_id>`
3. `extension-debug-report <source_id>`

Notes:

- All commands default to the latest artifact for the source when explicit artifact path is omitted.
- The runner persists browser session data under `.tmp/scraper-debug/playwright/<session_name>/` so repeated runs can be unattended after one successful login.

Artifact contract:

- Root path: `.tmp/scraper-debug/<normalized_source>/<timestamp>-<run_id>/`
- Files:
  - `artifact.json`
  - `run-response.json`
  - `debug-run.json`
  - `parse-output.json`
  - `network-captures.json`
  - `summary.json`
  - `diagnostics.json` (written by analyzer)
  - `report.md` (human-readable validation report)
  - `rows-preview.csv` (flat row preview for spreadsheet/manual checks)

Failure category codes from analyzer:

- `AUTH_BLOCKED`
- `API_DISCOVERY_MISSED`
- `API_4XX_5XX`
- `DOM_SELECTOR_DRIFT`
- `MAPPING_DROP`

## Debug Information

When writing or modifying code, add debug information as much as possible to support triage and incident recovery.

### What to add

- **Contextual IDs**: Include record IDs, batch IDs, user IDs, or session IDs in log messages and error payloads.
- **Operation names**: Log entry/exit of significant operations (e.g. `ocr_start`, `import_batch_complete`).
- **Error context**: Attach `cause`, status codes, and relevant identifiers when throwing or logging errors.
- **State transitions**: Log workflow state changes (e.g. `ocr_failed`, `batch_imported`) so logs can be correlated with DB state.

### Where to add it

- **Edge Functions**: Use `console.error` / `console.warn` with structured context (IDs, operation, error message). Avoid logging secrets.
- **API routes**: Return structured error payloads with `message`, `code`, and optional `details` (IDs, validation errors).
- **Hooks**: Persist error status and message for user feedback; log to console in development when useful.
- **DB workflows**: Ensure RPC/trigger errors surface in `return_message` or equivalent so cron logs are actionable.

### During triage

- Check function logs (Supabase dashboard, Vercel logs) for the contextual IDs above.
- Cross-reference with DB tables (`money_import_batch_rows`, `record_attachments`, etc.) using those IDs.
- See [`docs/design/common/error-handling-and-observability.md`](./design/common/error-handling-and-observability.md) for canonical guidance.
- See [`docs/observability/log-schema.md`](./observability/log-schema.md) for required structured log fields and PII policy.

## Incident Recovery Rules

- Prefer forward fixes over manual hot edits in DB.
- For DB incidents, ship a migration and matching `supabase/db` updates when needed.
- Do not rely on dashboard-only schema edits; capture diff in repo immediately.
- Do not hand-edit generated DB artifacts (`supabase/db/schema.snapshot.sql`, `supabase/db/database.types.ts`); regenerate via `db-artifacts-refresh`.
- `supabase/db/schema.snapshot.sql` is intentionally table-focused; functions/policies/triggers/RLS definitions are sourced from `supabase/db/` SQL files.
