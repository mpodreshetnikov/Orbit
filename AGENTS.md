# AGENTS Map

This file is a map, not a bible. Canonical project knowledge lives in `docs/`.

## Canonical Commands

Use these command IDs in plans, PRs, and handoffs:

- Source of truth for all available commands and descriptions: `just --list --unsorted`
- `commands-list`: `just commands-list`
- `hooks-install`: `just git-hooks-install` (enable repository git hooks, including pre-push secrets preflight)
- `hooks-status`: `just git-hooks-status`
- `install`: `just install-dependencies`
- `dev-ready`: `just dev-ready-local`
- `dev-stop`: `just dev-local-stop`
- `test`: `just quality-smoke-build` (current smoke/integration gate; no dedicated unit test runner yet)
- `lint`: `just quality-lint`
- `types`: `just quality-typecheck`
- `db-run`: `just supabase-local-migrate-and-deploy` (non-destructive; use for normal day-to-day local sync)
- `db-reset`: `just supabase-local-reset-and-deploy` (destructive; use when schema/seed drift needs a clean rebuild)
- `db-artifacts-refresh`: `just supabase-local-artifacts-refresh` (regenerate generated DB schema snapshot and TS DB types from reset local DB)
- `db-artifacts-verify`: `just supabase-local-artifacts-verify` (regenerate generated DB artifacts and fail on drift)
- `build-local`: `just build-local-all`
- `ci`: `just ci-verify-local`
- `mcp-sync`: `just mcp-sync` (regenerate local MCP client configs from canonical MCP config and local MCP env)
- `secrets-preflight`: `just secrets-preflight` (scan likely push range for accidentally committed secrets)
- `secrets-preflight-range`: `just secrets-preflight-range <from> <to>` (scan an explicit commit range; used by CI)

For less common and environment-specific commands (deploy, targeted DB ops, single-service dev flows), use `commands-list` and pick from `just --list --unsorted`.

### DB Command Guidance

- Prefer `db-run` when you want latest migrations + deploy SQL without wiping local data.
- Use `db-reset` after migration/seed refactors, when local DB state looks inconsistent, or when you need deterministic from-scratch validation.

## Where Rules Live

- Architecture rules: `docs/ARCHITECTURE.md`
- Debugging and operations: `docs/RUNBOOK.md`
- Quality gates and PR checks: `docs/QUALITY.md`
- Security and RLS expectations: `docs/SECURITY.md`
- Multi-hour execution plans index: `docs/PLANS.md/`

## Documentation DRY Rules

- `AGENTS.md` is a routing map and command registry, not a second source of policy text.
- Canonical policy must live in exactly one doc under `docs/`; other docs should link to it.
- Use command IDs (for example `db-reset`, `lint`) in docs and plans; avoid copying full command strings outside `AGENTS.md` unless a command variant is genuinely different.

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `docs/PLANS.md`) from design to implementation. Track any know and resolved debt in `docs/exec-plans/tech-debt-tracker.md`.
