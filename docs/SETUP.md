# Setup Guide

Use command IDs from `AGENTS.md` as the source of truth. This file explains setup flow and checks.

## Prerequisites

1. Supabase CLI installed.
2. Node.js and npm installed.
3. Environment variables configured.

## Environment Variables

Create `.env.local` in repo root:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

Get anon key from `supabase status` after local stack is up.

## Local Database Setup

1. Start local services:
```bash
supabase start
```
2. Run `db-reset` (from `AGENTS.md`).

Why `db-reset`:
- Runs migrations from `supabase/migrations/`.
- Runs idempotent DB deploy from `supabase/db/deploy.sql`.
- Ensures local state matches the two-track DB delivery model.

If you only need pending migration files without full reset, use:
```bash
supabase migration up
```
Then run `npm run db:deploy:local` so SQL objects from `supabase/db/` are still applied.

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
4. Restart Supabase:
```bash
supabase stop
supabase start
```

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

## Test Setup

1. Run `dev` (from `AGENTS.md`).
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
