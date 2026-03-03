# Local Dev Auth Bypass

## Purpose

Skip Google OAuth locally and sign in as any email for feature/bugfix testing. **For e2e validation, use bypass by default** unless the task explicitly requires verifying the real auth flow (login, OAuth, redirects).

## Required env

Set in local env (for example `.env.local`):

```env
DEV_AUTH_BYPASS_ENABLED=1
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=1
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```

Or start dev mode with bypass preconfigured for this session:

```bash
just dev start bypass
```

`bypass` is an auth mode parameter on the `dev` command. It enables:

- `DEV_AUTH_BYPASS_ENABLED=1`
- `NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=1`
- auto-population of `SUPABASE_SERVICE_ROLE_KEY` from local `supabase status` when available.

## Flow

1. Start environment with `dev-ready`.
2. Open `/login`.
3. Use **Local dev sign in** panel.
4. Enter target email and continue.

Default seeded login (from `supabase/seed.sql`):

- `dev@example.com`

Server behavior of `/auth/dev-login`:

- Validates local-dev bypass gate.
- Ensures user exists (create when missing).
- Upserts `public.allowed_users`.
- Generates magic-link hash and redirects through `/auth/callback`.

## Safety

- Intended for local/testing only.
- Must remain disabled by default.
- Never enable bypass in production.
