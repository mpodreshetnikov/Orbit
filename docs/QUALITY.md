# Quality

## Canonical Commands

Use command IDs and exact command strings from `AGENTS.md`.  
Source of truth for all commands and descriptions: `just --list --unsorted`.

Execution policy:
- Use `just` command IDs for project workflows (build/test/lint/db/dev/CI/MCP sync).
- Do not use `npm run` for project workflows when an equivalent `just` command exists.

## PR Definition Of Done

Every PR should satisfy all relevant items:

1. `test`, `lint`, and `types` were run and results are included in the PR.
2. `lint` must pass with zero warnings and zero errors.
3. DB changes include migrations in `supabase/migrations/`.
4. If SQL objects in `supabase/db/` are affected, matching updates are included there.
5. UI-visible changes include screenshots (or short recordings).
6. New behavior is documented in `docs/` (architecture, runbook, security, or plans as needed).

## MCP Config Generation

- Run `mcp-sync` when MCP server definitions change.
- Generated MCP client config files are local-only and must not be committed.

## Secret Leak Prevention

- Run `secrets-preflight` before pushing to scan the likely push range.
- CI runs `secrets-preflight-range` and blocks deploy jobs on secret findings.

## Documentation Rules

- Keep policy text canonical in one place; link from other docs instead of duplicating.
- `AGENTS.md` owns command IDs and their mapped `just` invocations.

## Database Change Rules

- No dashboard-only schema changes without a captured migration diff.
- Prefer deterministic, reviewable SQL in repo over ad-hoc dashboard edits.
- When changing policies/functions/triggers/cron, do changes in `supabase/db/` folder and run local reset/deploy before merge.
