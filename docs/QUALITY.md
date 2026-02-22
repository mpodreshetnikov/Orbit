# Quality

## Quality Model Overview

This document defines how quality is evaluated for every change set in this repository: what to run, how to validate outcomes, and how to score quality on a strict 0-100 scale.

Quality intent in this project spans:

- product behavior correctness,
- security and data integrity,
- reliability across lifecycle workflows,
- maintainability and architectural hygiene,
- delivery governance and release safety.

Command source of truth remains `AGENTS.md` and `just --list --unsorted`.

## Canonical Command Policy

Use command IDs from `AGENTS.md`.

- `test` -> `just quality-smoke-build`
- `test-unit-web` -> `just test-unit-web`
- `test-unit-ext` -> `just test-unit-ext`
- `test-unit-node` -> `just test-unit-node`
- `test-unit-functions` -> `just test-unit-functions`
- `test-unit` -> `just test-unit`
- `test-unit-coverage` -> `just test-unit-coverage`
- `coverage-report` -> `just coverage-report`
- `coverage-check` -> `just coverage-check`
- `format-check` -> `just quality-format-check`
- `format-write` -> `just quality-format-write`
- `lint` -> `just quality-lint`
- `lint-fix` -> `just quality-lint-fix`
- `lint-web` -> `just quality-lint-web`
- `lint-ext` -> `just quality-lint-extension`
- `lint-scripts` -> `just quality-lint-scripts`
- `lint-supabase` -> `just quality-lint-supabase-functions`
- `types` -> `just quality-typecheck`
- `quality` -> `just quality` (all static checks: format, lint, typecheck)
- `db-lint` -> `just quality-db-lint`
- `db-test` -> `just quality-db-test`
- `db-coverage-report` -> `just db-coverage-report`
- `ci` -> `just ci-verify-local`
- `ci-fast` -> `just ci-verify-local-fast` (quick local gate: format, lint, typecheck, unit tests, builds; no Supabase, no coverage; use for fast feedback; use `ci` for full pre-push/CI-equivalent gate)
- `check` -> `just check`
- `db-run` -> `just supabase-local-migrate-and-deploy`
- `db-reset` -> `just supabase-local-reset-and-deploy`
- `db-artifacts-refresh` -> `just supabase-local-artifacts-refresh`
- `db-artifacts-verify` -> `just supabase-local-artifacts-verify`
- `secrets-preflight` -> `just secrets-preflight`
- `secrets-preflight-range` -> `just secrets-preflight-range <from> <to>`

Do not replace these with ad-hoc alternatives when equivalent command IDs already exist.

## Test Impact Policy

Every behavior change must update tests in the same change set.

- If app/extension/script/edge behavior changes, add or update unit tests in the corresponding runtime lane (`test-unit-web`, `test-unit-ext`, `test-unit-node`, `test-unit-functions`).
- If SQL function/policy behavior changes under `supabase/migrations/` or `supabase/db/`, add or update pgTAP tests under `supabase/tests/`.
- Keep `supabase/tests/coverage-map.json` current when DB object naming does not map cleanly to pgTAP test file names.
- If no automated test change is required, include an explicit rationale in PR evidence (`why-no-test-change` note).

## Change-Type Check Matrix

| Change Type                            | Mandatory Checks                                                        | Additional Checks                                      | Evidence Required                              |
| -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Docs only                              | `lint` (if touched TS/JS snippets only), docs links check               | none                                                   | list of changed docs and cross-links validated |
| UI/routes/components                   | `lint`, `types`, `test-unit-web`, `test`                                | manual happy-path walkthrough on affected routes       | command outcomes + screenshots/recording       |
| Hooks/client orchestration             | `lint`, `types`, `test-unit-web`                                        | walkthrough for stale cache/mutation behavior          | command outcomes + brief behavior notes        |
| Edge/API workflow                      | `lint`, `types`, `test-unit-functions`, `test`                          | verify auth behavior and error path handling           | command outcomes + endpoint behavior notes     |
| DB schema/policy/function/trigger/cron | `lint`, `types`, `db-lint`, `db-test`, `db-run` or `db-reset` as needed | verify migration + `supabase/db` parity                | command outcomes + SQL diff rationale          |
| Extension/service worker/import flow   | `lint`, `types`, `test-unit-ext`, `test`                                | extension bridge/manual import scenario                | command outcomes + scenario transcript         |
| Scripts/tooling                        | `lint`, `types`, `test-unit-node`                                       | verify CLI behavior and error handling                 | command outcomes + command transcript          |
| CI/deploy/security config              | `lint`, `types`, `test-unit`, `test`, `secrets-preflight`               | check workflow/job behavior and required env contracts | command outcomes + config review notes         |

## How To Check Quality (Execution + Validation)

### 1. Static and build gates

Run from repository root:

- `format-check`
- `test-unit`
- `test-unit-coverage`
- `coverage-check`
- `test`
- `lint`
- `types`

Pass criteria:

- `format-check`: zero formatting drift.
- `lint`: zero warnings, zero errors.
- `lint`: includes web, extension, scripts, and Supabase function (`deno lint`) surfaces.
- `types`: no TypeScript diagnostics.
- `types`: includes Deno type checks for Supabase functions (`deno check`).
- `test-unit`: runtime-split unit suites pass (Vitest + Deno tests).
- `test-unit-coverage`: runtime coverage artifacts generated (`coverage/combined-summary.json`, `coverage/combined-report.md`).
- `coverage-check`: `src/**` coverage is enforced at `>=75%` lines and `>=75%` branches via `scripts/just/src-coverage-threshold.cjs`.
- `coverage-check`: Supabase Edge Functions are enforced per function directory aggregate at `>=75%` lines and `>=75%` branches via `scripts/just/supabase-function-coverage-threshold.cjs` (source: `.coverage/deno/lcov.info`).
- `coverage-check`: ratchet metrics are non-regressing and changed DB objects are mapped to pgTAP tests.
- `test` (smoke gate): successful production build and static generation.

### 2. Secret safety gate

Run:

- `secrets-preflight` before push.
- `secrets-preflight-range <from> <to>` for explicit ranges (CI-equivalent checks).

Prerequisite:

- Docker daemon available locally (current preflight runner executes gitleaks through Docker).

Pass criteria:

- no secret findings from gitleaks preflight.

### 3. DB integrity and lifecycle checks

When DB behavior changes:

- ensure migration exists in `supabase/migrations/`.
- ensure relevant SQL objects updated in `supabase/db/`.
- run `db-lint` to validate local DB SQL quality (`supabase db lint --local --schema public --fail-on warning`).
- run `db-test` to validate DB behavior contracts (`supabase test db --local supabase/tests`).
- run `db-run` for non-destructive validation.
- run `db-reset` when drift/refactor demands deterministic rebuild.
- regenerate DB artifacts via `db-artifacts-refresh`.

Generated DB artifacts policy:

- `supabase/db/schema.snapshot.sql` and `supabase/db/database.types.ts` are generated artifacts.
- Never edit these files by hand.
- Regenerate only via `db-artifacts-refresh`.
- `supabase/db/schema.snapshot.sql` is table-focused by design (tables/sequences/defaults + constraints/indexes only).
- `supabase/db/schema.snapshot.sql` intentionally excludes functions/triggers/policies/RLS/grants; those remain sourced from `supabase/db/` SQL files.
- CI enforces zero drift in clean environment via `db-artifacts-verify`.

Pass criteria:

- migrations apply cleanly,
- deploy SQL applies cleanly,
- DB lint passes (public schema) with zero warnings/errors,
- pgTAP suite passes for changed DB functions/policies,
- generated DB artifacts are current and unchanged after regeneration,
- runtime behavior reflects updated RLS/functions/triggers/cron.

### 4. Runtime behavior verification

For changed flows, verify:

- expected happy path,
- at least one failure path,
- auth/access behavior,
- data persistence and user-visible outcomes.

Use route and flow-specific evidence (screenshots, logs, notes).

### 5. Delivery governance checks

Validate that:

- CI workflow behavior is compatible with the change,
- CI `quality-gates` job is green before deployment jobs run,
- required docs were updated,
- security and operational implications were captured in relevant docs.

## Hybrid Quality Scoring Algorithm (0-100)

### Scoring rule

For each check item, assign:

- Full pass = `1.0`
- Partial pass = `0.5`
- Fail/not done = `0.0`

`item_points = item_weight * multiplier`

`category_points = sum(item_points)`

`total_score = sum(all_category_points)`

### Quality scorecard schema

Use this schema for each scored snapshot:

- `date` (ISO date)
- `category` (string)
- `weight` (points)
- `evidence` (commands/files/notes)
- `points_awarded` (0..weight)
- `cap_applied` (null or cap rule ID)
- `notes` (rationale)

### Category weights

| Category                             |  Weight |
| ------------------------------------ | ------: |
| Build and static gates               |      30 |
| Data/security integrity              |      20 |
| Reliability/lifecycle validation     |      20 |
| Maintainability/architecture hygiene |      20 |
| Delivery governance/evidence quality |      10 |
| **Total**                            | **100** |

### Category check items

#### A. Build and static gates (30)

- `A1` `test` pass: 10
- `A2` `lint` pass: 10
- `A3` `types` pass: 10

#### B. Data/security integrity (20)

- `B1` correct auth and access behavior for changed surfaces: 6
- `B2` DB migration + `supabase/db` parity when DB behavior changes: 6
- `B3` RLS/policy review quality for affected tables: 4
- `B4` secrets hygiene (`secrets-preflight` or range equivalent): 4

#### C. Reliability/lifecycle validation (20)

- `C1` happy-path scenario validation: 6
- `C2` failure-path validation and error handling: 6
- `C3` async/background/cron interactions validated when relevant: 4
- `C4` rollback/retry/operational recovery clarity: 4

#### D. Maintainability/architecture hygiene (20)

- `D1` change respects layering boundaries and avoids logic duplication: 6
- `D2` complexity impact managed (no unnecessary monolith growth): 6
- `D3` dead code/drift reduced or explicitly documented: 4
- `D4` docs updated in canonical locations: 4

#### E. Delivery governance and evidence quality (10)

- `E1` PR evidence completeness (commands + behavior notes): 4
- `E2` CI/deploy implications explicitly reviewed: 3
- `E3` clear follow-up debt items for residual risk: 3

## Mandatory Cap Rules And Fail-Fast Rules

| Rule ID  | Condition                                                         | Max Score |
| -------- | ----------------------------------------------------------------- | --------: |
| `CAP-01` | `lint` OR `types` OR `test` fails                                 |        49 |
| `CAP-02` | `secrets-preflight` fails                                         |         0 |
| `CAP-03` | DB changes skip migration and/or required `supabase/db` updates   |        39 |
| `CAP-04` | Security-sensitive changes lack explicit auth/RLS review evidence |        69 |

Cap application rule:

`final_score = min(raw_score, all_applicable_caps)`

## Baseline Quality Score (`2026-02-20`, strict)

### Baseline category breakdown

| Category                             |       Points |
| ------------------------------------ | -----------: |
| Build/static gates                   |      30 / 30 |
| Data/security integrity              |      11 / 20 |
| Reliability/lifecycle                |       6 / 20 |
| Maintainability/architecture hygiene |       7 / 20 |
| Delivery governance/evidence quality |       5 / 10 |
| **Total**                            | **59 / 100** |

### Baseline evidence snapshot

- static gates pass:
  - `just quality-lint`
  - `just quality-typecheck`
  - `just quality-smoke-build`
- CI currently enforces secret scan before deploy, but not lint/types/test in workflow jobs:
  - `.github/workflows/main.yml`
- automated test depth remains smoke-first with no dedicated unit/integration suite:
  - `justfile` (`quality-smoke-build` as test command)
- architecture maintainability debt remains significant in known hotspots:
  - `src/components/records/record-detail.tsx`
  - `src/components/records/structure-review-step.tsx`
  - `supabase/functions/health-structure/index.ts`

## PR Acceptance Thresholds

| Final Score | Quality Decision | Merge Expectation                                              |
| ----------- | ---------------- | -------------------------------------------------------------- |
| `0-49`      | Fail             | Do not merge                                                   |
| `50-69`     | Risky            | Merge blocked unless explicit maintainer exception + debt plan |
| `70-84`     | Acceptable       | Merge allowed when required evidence is complete               |
| `85-100`    | Strong           | Preferred target for high-impact changes                       |

Additional merge blockers regardless of score:

- unresolved secret findings,
- missing DB safety artifacts for DB behavior changes,
- unresolved critical auth/RLS defects.

## Reassessment Cadence

- Recompute quality baseline monthly.
- Recompute immediately after major CI/process changes.
- Recompute after major architecture migrations (domain, DB, notification/import pipelines).
- Keep a dated log entry for each reassessment in this document.

### Reassessment Log

| Date         | Score | Notes                   |
| ------------ | ----: | ----------------------- |
| `2026-02-20` |    59 | Initial strict baseline |
