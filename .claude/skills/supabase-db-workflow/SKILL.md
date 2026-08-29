---
name: supabase-db-workflow
description: Repository-specific workflow for Supabase DB changes. Use this skill for any task that edits database schema, SQL functions, RLS policies, triggers, cron jobs, DB tests, or generated DB artifacts in this repo.
---

# Supabase DB Workflow (Repo-Specific)

Use this skill for every task that changes the database in this repository.

## Mandatory Trigger

Apply this skill whenever a task touches any of:

- `supabase/db/**`
- `supabase/migrations/**`
- `supabase/tests/**`
- `supabase/seed.sql`
- any app/edge code that depends on changed SQL objects

## Current DB Structure In This Repo

Primary database source files live in `supabase/db/`:

- `supabase/db/types/`: enum and custom type SQL
- `supabase/db/functions/`: SQL function definitions
- `supabase/db/triggers/`: trigger definitions
- `supabase/db/policies/`: RLS policy definitions
- `supabase/db/cron/`: cron/job SQL
- `supabase/db/01_types_functions.sql`: compose types + functions
- `supabase/db/02_triggers.sql`: compose triggers
- `supabase/db/03_policies.sql`: compose policies
- `supabase/db/04_cron.sql`: compose cron/jobs
- `supabase/db/deploy.sql`: deploy entrypoint assembled from the files above
- `supabase/db/schema.snapshot.sql`: generated schema snapshot artifact
- `supabase/db/database.types.ts`: generated TypeScript DB types

Additional DB-related locations:

- `supabase/migrations/`: migration history (especially table evolution)
- `supabase/tests/functions/` and `supabase/tests/policies/`: pgTAP coverage for DB behavior
- `supabase/tests/coverage-map.json`: DB object to test mapping

## Migration Rule For This Stack

- Do **not** create migrations for routine DB logic edits (functions, triggers, policies, cron, grants, helper SQL).
- For those changes, editing files in `supabase/db/` is sufficient.
- Create/update a migration in `supabase/migrations/` only when table structure changes are required (for example table create/alter/drop, columns, constraints, indexes tied to table shape).
- A new migration's timestamp must sort **after** every migration already on `main`. Production applies migrations with `--include-all`, so a file added below the latest one runs against a schema the newer migrations already changed -- an order `db-reset` never exercises, because it always replays from scratch in filename order. If your branch was opened before another migration merged, rename yours to a later timestamp; the contents do not change, only the ordering. `quality-migration-order` (part of `quality`) enforces this, and `supabase/migrations/.out-of-order-allowlist` is the reviewed exception.

## Execution Flow

1. Edit the canonical SQL in `supabase/db/` first.
2. If table structure changed, add/update migration under `supabase/migrations/`.
3. Update pgTAP tests in `supabase/tests/**` for behavior changes.
4. Run relevant DB checks:
   - `db-run` for normal local sync
   - `db-lint`
   - `db-test`
   - `db-reset` when deterministic rebuild is needed
5. Refresh artifacts when needed:
   - `db-artifacts-refresh` (regenerates `schema.snapshot.sql` and `database.types.ts`)
6. If artifacts changed, commit regenerated outputs with SQL/test changes.

## Guardrails

- Treat `supabase/db/schema.snapshot.sql` and `supabase/db/database.types.ts` as generated outputs; prefer regeneration over manual edits.
- Keep RLS expectations aligned with `docs/SECURITY.md`.
- Keep DB quality workflow aligned with `docs/QUALITY.md`.
