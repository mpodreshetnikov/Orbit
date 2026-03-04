# AGENTS Map

This file is a map, not a bible. Canonical project knowledge lives in `docs/`.

## Canonical Commands

Use these command IDs in plans, PRs, and handoffs:

- Source of truth for all available commands and descriptions: `just --list --unsorted`
- `commands-list`: `just commands-list`
- `hooks-install`: `just git-hooks-install` (enable repository git hooks, including pre-push secrets preflight)
- `hooks-status`: `just git-hooks-status`
- `install`: `just install-dependencies`
- `dev-ready`: `just dev-ready-local` (long-running: run in background when invoked by an agent—see below)
- `dev-stop`: `just dev-local-stop`
- `dev`: `just dev` (start local developer stack; long-running for HMR/watch workflows; use `just dev stop` when teardown is needed)
- `obs-up`: `just obs-up` (start local Grafana LGTM stack)
- `obs-down`: `just obs-down` (stop local Grafana LGTM stack)
- `format-check`: `just quality-format-check`
- `format-write`: `just quality-format-write`
- `test`: `just quality-smoke-build` (smoke/integration build gate)
- `test-unit-web`: `just test-unit-web`
- `test-unit-ext`: `just test-unit-ext`
- `test-unit-node`: `just test-unit-node`
- `test-unit-functions`: `just test-unit-functions`
- `test-unit`: `just test-unit` (all fast runtime-split unit lanes)
- `test-unit-coverage`: `just test-unit-coverage`
- `test-e2e`: `just test-e2e` (Playwright end-to-end lane for real local product flows; includes extraction coverage and runs in deterministic no-external-LLM mode where applicable)
- `coverage-report`: `just coverage-report`
- `coverage-check`: `just coverage-check`
- `lint`: `just quality-lint`
- `lint-fix`: `just quality-lint-fix`
- `lint-web`: `just quality-lint-web`
- `lint-ext`: `just quality-lint-extension`
- `lint-scripts`: `just quality-lint-scripts`
- `lint-supabase`: `just quality-lint-supabase-functions`
- `functions-lock-check`: `just quality-check-supabase-functions-lock` (verify Supabase Edge Functions lockfile format compatibility)
- `functions-lock-refresh`: `just supabase-functions-lock-refresh` (regenerate `supabase/functions/deno.lock` with runtime-compatible Deno)
- `types`: `just quality-typecheck`
- `quality`: `just quality` (all static checks: format, lint, typecheck; no builds, DB, or tests)
- `db-lint`: `just quality-db-lint` (local DB lint scoped to `public` schema, warnings fail)
- `db-test`: `just quality-db-test` (pgTAP tests under `supabase/tests`)
- `db-coverage-report`: `just db-coverage-report` (DB object to pgTAP mapping coverage report)
- `db-run`: `just supabase-local-migrate-and-deploy` (non-destructive; use for normal day-to-day local sync)
- `db-reset`: `just supabase-local-reset-and-deploy` (destructive; use when schema/seed drift needs a clean rebuild)
- `db-artifacts-refresh`: `just supabase-local-artifacts-refresh` (regenerate generated DB schema snapshot and TS DB types from reset local DB)
- `db-artifacts-verify`: `just supabase-local-artifacts-verify` (regenerate generated DB artifacts and fail on drift)
- `build-local`: `just build-local-all`
- `ci`: `just ci-verify-local` (run after completing a task that changed code; see docs/QUALITY.md)
- `ci-fast`: `just ci-verify-local-fast` (quick local gate: no Supabase, no coverage; use for fast feedback; use `ci` for full pre-push)
- `check`: `just check` (full local quality gate)
- `mcp-sync`: `just mcp-sync` (regenerate local MCP client configs from canonical MCP config and local MCP env)
- `mcp-grafana-token-create`: `just mcp-grafana-token-create [service_account_id] [token_name]` (create a local Grafana service account token for MCP via Grafana API; auto-creates `mcp-local` when id is omitted)
- `mcp-grafana-token-list`: `just mcp-grafana-token-list [service_account_id]` (list local Grafana service account token metadata via Grafana API; defaults to `mcp-local`)
- `secrets-preflight`: `just secrets-preflight` (scan likely push range for accidentally committed secrets)
- `secrets-preflight-range`: `just secrets-preflight-range <from> <to>` (scan an explicit commit range; used by CI)

For less common and environment-specific commands (deploy, targeted DB ops, single-service dev flows), use `commands-list` and pick from `just --list --unsorted`.

### Long-running commands (run in background when invoked by an agent)

Commands such as `dev-ready` start servers and do not exit until the stack is stopped. If an agent runs them in the foreground, the agent will wait indefinitely. **Run these in the background** so the agent does not block:

- **How:** Start the command with background execution (e.g. run the terminal command with your environment’s “run in background” / “don’t wait for exit” option, such as `is_background: true`). The stack will keep running; use `dev-stop` when teardown is needed.
- **Which:** `dev-ready`, `dev` (when starting the stack).
- **If background execution is disabled:** Do not start the stack from the agent. Ask the user to run `dev-ready` or `dev` in a separate terminal before tasks that need the stack, and to run `dev-stop` in that terminal when done.

### DB Command Guidance

- Prefer `db-run` when you want latest migrations + deploy SQL without wiping local data.
- Use `db-reset` after migration/seed refactors, when local DB state looks inconsistent, or when you need deterministic from-scratch validation.
- Run `db-lint` to validate DB quality before merge (`--schema public --fail-on warning`).
- Run `db-test` to validate DB functions/policies with pgTAP before merge.

## Where Rules Live

- Architecture rules: `docs/ARCHITECTURE.md`
- Debugging and operations: `docs/RUNBOOK.md`
- Debug information in code: `docs/design/common/error-handling-and-observability.md`
- Quality gates and PR checks: `docs/QUALITY.md`
- Security and RLS expectations: `docs/SECURITY.md`
- Multi-hour execution plans index: `docs/PLANS.md/`

## Documentation DRY Rules

- `AGENTS.md` is a routing map and command registry, not a second source of policy text.
- Canonical policy must live in exactly one doc under `docs/`; other docs should link to it.
- Use command IDs (for example `db-reset`, `lint`) in docs and plans; avoid copying full command strings outside `AGENTS.md` unless a command variant is genuinely different.

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `docs/PLANS.md`) from design to implementation. Track any know and resolved debt in `docs/exec-plans/tech-debt-tracker.md`.
