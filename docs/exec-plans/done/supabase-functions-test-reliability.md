# Supabase Edge Functions Test Reliability and Coverage Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` are updated as work proceeds.

This repository contains `docs/PLANS.md`, and this document is maintained in accordance with that file.

## Purpose / Big Picture

After this change, all five live Supabase Edge Functions (`health-ocr`, `health-structure`, `icd-lookup`, `money-import`, `notifications-cron`) are tested through deterministic unit suites that do not call live internet services. Function internals are split into injectable seams so behavior can be tested at service and adapter levels rather than only through shallow handler guards.

Success is observable by running the canonical quality commands and seeing each Supabase function directory clear `>=75%` line and branch coverage from Deno LCOV, with passing function unit suites and no HTTP contract regressions at function boundaries.

## Progress

- [x] (2026-02-22T00:00:00Z) Validate baseline state: existing function tests pass but only cover shallow guard paths, and per-function coverage is far below target.
- [x] (2026-02-22T00:05:00Z) Confirm implementation scope with user due large unrelated pre-existing dirty worktree; approved to touch only function/test/coverage/doc files for this task.
- [x] (2026-02-22T01:10:00Z) Add shared Deno test harness utilities under `supabase/functions/_shared/testing`.
- [x] (2026-02-22T01:45:00Z) Refactor `icd-lookup` into handler + service + WHO client + deps and add granular tests.
- [x] (2026-02-22T03:25:00Z) Refactor `health-ocr` into handler + service + OpenRouter client + repository + deps and add granular tests.
- [x] (2026-02-22T05:15:00Z) Refactor `notifications-cron` into digest/provider/push seams and add granular tests.
- [x] (2026-02-22T07:20:00Z) Refactor `money-import` into auth/normalize/actions/repository seams and add granular tests.
- [x] (2026-02-22T09:10:00Z) Refactor `health-structure` into prompt/openrouter-parse/unit-conversion/resolution seams and add granular tests.
- [x] (2026-02-22T09:30:00Z) Add per-function Supabase coverage threshold script and wire it into canonical coverage checks.
- [x] (2026-02-22T09:35:00Z) Update `docs/QUALITY.md`, `docs/RUNBOOK.md`, and `docs/exec-plans/tech-debt-tracker.md` to reflect completed debt and new enforcement.
- [x] (2026-02-22T09:45:00Z) Run full Supabase function coverage validation and capture outcomes.

## Surprises & Discoveries

- Observation: Existing Deno coverage output reports very high line denominators for large handlers, especially `health-structure` and `money-import`.
  Evidence: Baseline run produced per-function directory coverage below 20% lines for most handlers despite passing tests.

- Observation: Existing branch denominators are comparatively low for large handlers.
  Evidence: Baseline per-function branch denominators were in the teens/twenties, making branch target feasible once non-guard flows execute.

## Decision Log

- Decision: Keep runtime HTTP contract unchanged while introducing `create<FunctionName>Handler(deps)` exports and dependency interfaces.
  Rationale: This enables deterministic testing and seam injection without changing how callers invoke functions.
  Date/Author: 2026-02-22 / Codex

- Decision: Implement per-function aggregate coverage gate from `.coverage/deno/lcov.info` with strict treatment of uninstrumented production files as zero-hit.
  Rationale: User requirement explicitly asks for per-function coverage guarantees, not just tracked-only reporting.
  Date/Author: 2026-02-22 / Codex

## Outcomes & Retrospective

- All five live Supabase functions are now split into testable seams with injectable dependencies at handler/service/adaptor boundaries.
- External HTTP/web-push interactions are mocked in unit tests; no live internet dependency remains in the function unit lane.
- Coverage gate support was added via `scripts/just/supabase-function-coverage-threshold.cjs` and wired into `coverage-check`.
- Final merged per-function aggregate from `.coverage/deno-temp/lcov.info` (excluding `_shared`, tests, `index.ts`, `.d.ts`) is:
  - `health-ocr`: lines 96.92%, branches 92.86%
  - `health-structure`: lines 90.97%, branches 88.73%
  - `icd-lookup`: lines 82.30%, branches 75.31%
  - `money-import`: lines 92.35%, branches 84.26%
  - `notifications-cron`: lines 94.29%, branches 86.23%
- Coverage reliability issue with duplicate Deno LCOV `SF` entries is handled by per-file merge (max metrics) inside the threshold script before per-function aggregation.

## Context and Orientation

Supabase Edge Functions live under `supabase/functions/` and each function has an `index.ts` entrypoint that currently just calls `Deno.serve(handleRequest)`. Business logic currently sits mostly in large `handler.ts` files and existing tests primarily validate CORS and missing-env failure guards.

Relevant command IDs (canonical):

- `test-unit-functions`
- `test-unit-coverage`
- `coverage-check`
- `lint-supabase`
- `types`
- `check`

Coverage aggregation is currently produced by `scripts/just/coverage-report.cjs` from `.coverage/deno/lcov.info` and Vitest coverage artifacts.

## Plan of Work

Implementation is split into two milestones:

1. Build shared testing utilities and complete seam refactors plus deep tests for `icd-lookup` and `health-ocr`.
2. Apply same seam strategy to `notifications-cron`, `money-import`, and `health-structure`, then add strict per-function coverage gating and docs updates.

For each function, the handler module retains HTTP orchestration while domain logic and external side effects move into injectable collaborators. Tests cover positive and negative cases at both service-level and handler-level boundaries with explicit mock responses for internet calls.

## Concrete Steps

From repository root:

1. Implement shared testing utilities under `supabase/functions/_shared/testing`.
2. Refactor each target function module set.
3. Add/expand tests listed in this plan.
4. Add `scripts/just/supabase-function-coverage-threshold.cjs`.
5. Wire script into `justfile` coverage commands.
6. Update docs and debt tracker.
7. Run:
   - `just test-unit-functions`
   - `just test-unit-coverage`
   - `just coverage-check`
   - `just quality-lint-supabase-functions`
   - `just quality-typecheck`
   - `just check`

## Validation and Acceptance

Acceptance criteria:

- All Supabase function tests pass with network mocked.
- No runtime entrypoint contract changes (`supabase/functions/*/index.ts` unchanged behavior).
- Per-function aggregate coverage from Deno LCOV is `>=75%` lines and `>=75%` branches for:
  - `health-ocr`
  - `health-structure`
  - `icd-lookup`
  - `money-import`
  - `notifications-cron`
- Canonical quality commands complete successfully.

## Idempotence and Recovery

All code edits are additive/refactor-safe and can be re-run. Coverage and test commands are repeatable. If a refactor causes regressions, each function can be tested independently via `test-unit-functions` and isolated by running Deno tests scoped to that function directory.

## Artifacts and Notes

This section is updated with final command outputs and notable diffs after implementation.

## Interfaces and Dependencies

Each function handler exports:

- `create<FunctionName>Handler(deps): (req: Request) => Promise<Response>`
- `<FunctionName>Deps` interface
- `handleRequest` default export wiring production deps

Shared test utilities expose:

- env override/restore helper
- fetch stub and verification helper
- no-network guard
- response assertion helpers
