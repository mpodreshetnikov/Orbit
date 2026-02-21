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
- Configure GitHub Actions Vercel values:
  - Secrets: `VERCEL_TOKEN`
  - Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- Configure GitHub Actions Supabase values:
  - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASEDBPASS`
  - Variables: `SUPABASE_PROJECT_REF`
- Disable Vercel's automatic Git deploy integration if you want GitHub Actions to be the only deployment trigger.
- Command execution policy (including avoiding `npm run` for project workflows) is canonical in `docs/QUALITY.md`.
- MCP setup instructions are in `mcp/README.md`.

## Triage Checklist

1. Classify surface: web route, API route, Edge Function, DB/RPC/cron.
2. Confirm environment and commit SHA first.
3. Reproduce locally if possible.
4. Check recent DB migrations and `supabase/db` changes.
5. If DB schema/types drift is suspected, run `db-artifacts-verify` from `AGENTS.md`.
6. Decide whether the fix is app code, function code, SQL, or config/secrets.

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
- Edge Function: `supabase/functions/notifications-cron/index.ts`

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

- `supabase/functions/health-ocr/index.ts`
- `supabase/functions/health-structure/index.ts`

Checks:

- Confirm required secrets are set (`OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- Confirm attachment exists in `medical-attachments` bucket.
- Check function logs for auth failures, timeout, or model/provider errors.

## Money Import Issues

Function:

- `supabase/functions/money-import/index.ts`

Checks:

- Verify auth mode (user bearer token or import session token).
- Inspect import session/batch tables for status and errors:
  - `money_import_sessions`
  - `money_import_batches`
  - `money_import_batch_rows`
- Verify upsert RPC behavior (`money_upsert_transactions_batch`).

## Incident Recovery Rules

- Prefer forward fixes over manual hot edits in DB.
- For DB incidents, ship a migration and matching `supabase/db` updates when needed.
- Do not rely on dashboard-only schema edits; capture diff in repo immediately.
- Do not hand-edit generated DB artifacts (`supabase/db/schema.snapshot.sql`, `supabase/db/database.types.ts`); regenerate via `db-artifacts-refresh`.
- `supabase/db/schema.snapshot.sql` is intentionally table-focused; functions/policies/triggers/RLS definitions are sourced from `supabase/db/` SQL files.
