# Auth, RLS, And Trust Boundaries

## Intent

Define how identity, authorization, and data access constraints are enforced across middleware, APIs, edge functions, and database policies.

## Current Implementation In This Repo

- Middleware-first auth gate:
  - `src/middleware.ts`
  - `src/lib/supabase-middleware.ts`
- Server auth utilities:
  - `src/lib/supabase-server.ts`
- DB helper functions:
  - `supabase/db/functions/_is_allowed_user.sql`
  - `supabase/db/functions/_is_owner_of_person.sql`
- RLS policies:
  - `supabase/db/policies/*`
- Edge functions configured with `verify_jwt = false` in `supabase/config.toml` and manual auth validation in function code.

## Rules To Follow

1. Every new user-data table must have explicit RLS/policy coverage.
2. Every new endpoint/function must declare and implement auth behavior.
3. Service-role keys are server/edge only, never client.
4. Any function with `verify_jwt = false` must validate bearer token and allowlist context if user-facing.
5. Security-sensitive changes must include policy and auth evidence in PR.

## Anti-Patterns To Avoid

- Relying on client-side route restrictions as primary protection.
- Silent auth fallback behavior in sensitive endpoints.
- Shipping policy updates without corresponding migration/deploy artifacts.

## Tradeoffs

- Allowlist-first model simplifies trusted family use, but is less granular than strict owner-scoped rules.
- Manual auth validation in edge functions increases flexibility but requires strict discipline.

## Known Gaps And Next Refactor Targets

- Broader owner-scoped partitioning is still incomplete for some data tables.
- Security review evidence is not yet hard-gated in CI.

## References

- [`docs/SECURITY.md`](../../SECURITY.md)
- [`docs/QUALITY.md`](../../QUALITY.md)
- `supabase/db/policies/money_transactions.sql`
- `supabase/db/policies/medical_records.sql`
