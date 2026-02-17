# AGENTS Map

This file is a map, not a bible. Canonical project knowledge lives in `docs/`.

## Canonical Commands

Use these command IDs in plans, PRs, and handoffs:

- `dev`: `npm run web`
- `test`: `npm run web:build` (current smoke/integration gate; no dedicated unit test runner yet)
- `lint`: `npx eslint src browserExtension/src browserExtension/popup-src scripts/extension supabase/functions --ext .ts,.tsx --max-warnings=0`
- `db-reset`: `npx supabase db reset && npm run db:deploy:local`
- `types`: `npx tsc --noEmit`

## Where Rules Live

- Architecture rules: `docs/ARCHITECTURE.md`
- Debugging and operations: `docs/RUNBOOK.md`
- Quality gates and PR checks: `docs/QUALITY.md`
- Security and RLS expectations: `docs/SECURITY.md`
- Multi-hour execution plans: `docs/PLANS/`

## Documentation DRY Rules

- `AGENTS.md` is a routing map and command registry, not a second source of policy text.
- Canonical policy must live in exactly one doc under `docs/`; other docs should link to it.
- Use command IDs (for example `db-reset`, `lint`) in docs and plans; avoid copying full command strings outside `AGENTS.md` unless a command variant is genuinely different.
