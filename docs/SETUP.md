# Setup Guide

Use command IDs from `AGENTS.md` as the source of truth.  
Source of truth for available commands and descriptions: `just --list --unsorted`.
Command execution policy is canonical in `docs/QUALITY.md` (use `just` for project workflows).
MCP setup and sync instructions are canonical in `mcp/README.md`.

## Prerequisites

1. `just` installed.
2. Supabase CLI installed.
3. Node.js and npm installed.
4. Deno 2.x installed.
5. Docker Desktop installed (required for local Supabase and lock refresh workflows).
6. Environment variables configured.

If Edge Functions fail with `Unsupported lockfile version` errors, run `functions-lock-refresh` from `AGENTS.md` to regenerate `supabase/functions/deno.lock` with the local edge-runtime-compatible Deno image.

## Environment Variables

Create `.env.local` in repo root:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

Get anon key from local Supabase status output after stack is up (for one-off commands, use `commands-list` from `AGENTS.md`).

Observability env template:

- Copy `.env.observability.example` values into your local env source as needed.
- Local dev lifecycle (`dev-ready`/`dev-stop`) auto-starts/stops observability unless `OBS_AUTO=0`.

## Local Database Setup

1. For normal local sync, run `db-run` from `AGENTS.md` (non-destructive).
2. If you need a clean rebuild, run `db-reset` from `AGENTS.md` (destructive).
3. Regenerate generated DB artifacts with `db-artifacts-refresh` from `AGENTS.md`.

Why `db-reset`:

- Runs migrations from `supabase/migrations/`.
- Runs idempotent DB deploy from `supabase/db/deploy.sql`.
- Ensures local state matches the two-track DB delivery model.

DB artifact note:

- `supabase/db/schema.snapshot.sql` and `supabase/db/database.types.ts` are generated files.
- `supabase/db/schema.snapshot.sql` is a table-only snapshot (table structure + constraints/indexes), not a full logical object dump.
- Do not edit them by hand; use `db-artifacts-refresh`.
- Canonical policy for generated DB artifacts is in `docs/QUALITY.md`.

## Notifications Cron

The notifications `pg_cron` job calls `notifications-cron` via `pg_net`. URL comes from Vault secret `project_url`.

- Local: after `db-reset`, seed sets `project_url` to `http://kong:8000`.
- Hosted: run once:

```sql
select vault.create_secret('https://<your-project-ref>.supabase.co', 'project_url');
```

Remove any manually created duplicate notifications cron job.

## Google OAuth (Local)

1. Open `supabase/config.toml`.
2. Configure `[auth.external.google]` with your client ID and env-backed secret:

```toml
[auth.external.google]
enabled = true
client_id = "your-google-client-id.apps.googleusercontent.com"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = true
email_optional = false
```

3. Provide the secret via environment, for example in `supabase/.env`:

```env
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=your-google-client-secret
```

4. Restart local stack:

- Run `dev-stop` from `AGENTS.md`.
- Run `dev-ready` from `AGENTS.md`.

### Getting Google OAuth Credentials

1. Open Google Cloud Console.
2. Create/select project.
3. Configure OAuth consent screen.
4. Create OAuth 2.0 Client ID credentials.
5. Use redirect URI `http://127.0.0.1:54321/auth/v1/callback`.
6. Copy Client ID and Client Secret.

## Add Users To Allowlist

Add pre-approved users by email in SQL Editor:

```sql
insert into public.allowed_users (email)
values ('user@example.com');
```

Multiple users:

```sql
insert into public.allowed_users (email) values
  ('user1@example.com'),
  ('user2@example.com'),
  ('user3@example.com');
```

Verify in Table Editor `allowed_users`. `auth_user_id` stays null until first sign-in.

## Local Dev Auth Bypass (No Google)

Use this only for local testing when you need to sign in quickly as any email.

1. Add local env flags in `.env.local`:

```env
DEV_AUTH_BYPASS_ENABLED=1
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=1
SUPABASE_SERVICE_ROLE_KEY=<your-local-service-role-key>
```

2. Ensure local stack is running (`dev-ready` from `AGENTS.md`).
3. Open `/login`.
4. In **Local dev sign in**, enter any email and continue.

How it works:

- Calls `GET /auth/dev-login?email=<email>&next=<path>`.
- Creates user when missing (or reuses existing user).
- Upserts `public.allowed_users`.
- Generates a magic-link token and completes login via `/auth/callback`.

Safety constraints:

- Disabled by default.
- Works only when `DEV_AUTH_BYPASS_ENABLED=1` and non-production runtime.
- Requires `SUPABASE_SERVICE_ROLE_KEY` in local env.

## Test Setup

1. Start all local services in one terminal: run `dev-ready` from `AGENTS.md` (recommended).
2. Open `http://127.0.0.1:3000`.
3. Confirm redirect to `/login`.
4. Sign in with Google.
5. Confirm:

- Not allowlisted -> `/access-denied`.
- Allowlisted -> `/health`.

## Exit Criteria

- [x] Only allowlisted users can access app pages.
- [x] Non-allowed users see access denied screen.
- [x] Google OAuth login works.
- [x] Logout works.
- [x] User info appears in top nav.
