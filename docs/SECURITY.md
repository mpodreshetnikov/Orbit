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
- Supabase Edge Functions:
  - `OPENROUTER_API_KEY`
  - `WHO_ICD_CLIENT_ID`
  - `WHO_ICD_CLIENT_SECRET`
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- GitHub Actions deploy pipeline (`.github/workflows/main.yml`):
  - Secrets: `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASS`
  - Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_PROJECT_REF`

## Service Role Boundaries

- Service-role credentials are allowed only in server contexts (Next API routes, Edge Functions, deploy scripts).
- Never expose service-role keys to client bundles.
- Functions with `verify_jwt = false` must validate bearer tokens manually unless they are strictly internal cron-style endpoints.

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
2. Any new API/Edge endpoint has explicit auth behavior.
3. No secrets are added to source, logs, or screenshots.
4. External API calls use least-privilege credentials and clear timeouts.
5. Migration and policy diffs are reviewed together.
