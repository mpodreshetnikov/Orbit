# Quality

## Canonical Commands

Use command IDs and exact command strings from `AGENTS.md`.

## PR Definition Of Done

Every PR should satisfy all relevant items:

1. `test`, `lint`, and `types` were run and results are included in the PR.
2. `lint` must pass with zero warnings and zero errors.
3. DB changes include migrations in `supabase/migrations/`.
4. If SQL objects in `supabase/db/` are affected, matching updates are included there.
5. UI-visible changes include screenshots (or short recordings).
6. New behavior is documented in `docs/` (architecture, runbook, security, or plans as needed).

## Documentation Rules

- Keep policy text canonical in one place; link from other docs instead of duplicating.
- `AGENTS.md` owns command strings and IDs.

## Database Change Rules

- No dashboard-only schema changes without a captured migration diff.
- Prefer deterministic, reviewable SQL in repo over ad-hoc dashboard edits.
- When changing policies/functions/triggers/cron, do changes in `supabase/db/` folder and run local reset/deploy before merge.
