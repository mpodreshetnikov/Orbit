# Architecture

## System Overview

This repo is a monorepo-style single app with three runtime surfaces:

- Web app: Next.js App Router in `src/app`
- Browser extension: source in `browserExtension/`, build script in `scripts/extension/build.ts`
- Backend: Supabase Postgres + Edge Functions in `supabase/`

Primary domains are health records/medications/notifications and money tracking/import.

## Code Map

- `src/app`: routes, layouts, API routes
- `src/components`: UI and domain components
- `src/hooks`: client data access and mutations (React Query + Supabase)
- `src/lib`: shared helpers and Supabase clients
- `supabase/migrations`: schema evolution history
- `supabase/db`: idempotent deploy scripts for functions, triggers, policies, cron
- `supabase/functions`: Edge Functions (`health-ocr`, `health-structure`, `icd-lookup`, `money-import`, `notifications-cron`)
- `docs/`: system-of-record docs and plans

## Runtime Boundaries

- Client code uses the browser Supabase client from `src/lib/supabase.ts`.
- Server routes/components use server clients in `src/lib/supabase-server.ts` and `src/lib/supabase-middleware.ts`.
- Auth gate is middleware-first (`src/middleware.ts`) plus DB allowlist checks (`public.allowed_users`).
- Durable business rules live in Postgres (RLS, RPC, triggers, cron), not in UI components.

## Critical Flows

1. Auth and access

- Request hits middleware, session is refreshed, non-allowlisted users are redirected.

2. Health document pipeline

- Attachment upload -> `health-ocr` (text extraction) -> review -> `health-structure` (structured extraction) -> user confirmation -> DB write.

3. Notification pipeline

- `pg_cron` schedules DB jobs -> DB RPC creates digests -> `notifications-cron` sends push payloads -> digests marked sent.

4. Money import pipeline

- File or extension data -> `money-import` function -> batch/session tables + transaction upsert RPC -> UI reconciliation.

## Database Delivery Model

Two tracks are used together:

- `supabase/migrations/`: schema changes and migration history.
- `supabase/db/`: idempotent deployment of types/functions/triggers/policies/cron via `deploy.sql`.

If DB behavior changes, update both tracks when applicable.

## Architecture Rules

- Keep `AGENTS.md` short; put durable architecture rules here.
- Keep docs DRY: each policy has one canonical home in `docs/`; other docs should link to it.
- Prefer DB-enforced rules (RLS/functions/triggers) over duplicated UI-only constraints.
- Any new table touching user data must have explicit RLS policy updates in `supabase/db/policies/`.
- Edge Functions with `verify_jwt = false` must do explicit token validation and allowlist checks in function code.
- No dashboard-only schema changes; capture migrations in `supabase/migrations/`.
- Keep route files thin; put reusable logic in `src/hooks`, `src/lib`, or SQL/RPC as appropriate.
- Keep user-facing copy in `src/messages/*.json` for i18n consistency.
