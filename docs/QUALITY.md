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

## Primary commands

Use the full command list in **AGENTS.md** and `just --list --unsorted`. For day-to-day quality checks, use these entry points:

- **`dev`**: local developer runtime check. Run `just dev` after code changes to verify the dev build boots cleanly. Keep it running for HMR/watch workflows; use `just dev stop` only when teardown is needed.
- **`ci-fast`**: quick local gate (format, lint, types, unit tests, web + extension builds). Use for fast feedback during work. No Supabase, no coverage.
- **`ci`**: full local gate (adds `build-local-all`, unit coverage, `coverage-check`, `test-e2e`). Use before push or PR.
- **`test-e2e`**: Playwright end-to-end validation lane for user-facing product flows (including extraction) against local Supabase. Extraction-related suites run in deterministic `HEALTH_STRUCTURE_PARSER_MODE=e2e_stub` mode (no external LLM calls). Runner enforces this mode by restarting local Supabase when needed.
- CI runs `test-e2e` when change impact includes web, DB, or Supabase Edge Functions surfaces.
- **`quality`**: static checks only (format, lint, typecheck). No builds or tests.
- **`test-extraction`**: scored extraction quality against the fixture corpus in `test/fixtures/extraction/`. See "Extraction quality" below. **Not a gate** — it is not part of `ci`, `ci-fast`, `check` or `coverage-check`, and it never runs on a pull request.

## Extraction quality

`test-extraction` measures how well `health-structure` turns document text into entities. It is a
report, not a pass/fail gate.

It is the deliberate opposite of `test-e2e`. That lane pins `HEALTH_STRUCTURE_PARSER_MODE=e2e_stub`
so extraction flows never reach a model — it proves the plumbing works and says nothing about
answer quality. `test-extraction` exercises the real prompts and the real deterministic
post-processing, which is the only way to see quality at all.

- **Default is replay.** Recorded provider responses live in `test/fixtures/extraction/cassettes/`,
  so a normal run is free, offline and deterministic. Cassettes are keyed on the full request body:
  change a prompt, a catalogue entry or a fixture and the recording correctly stops matching.
- **`--live` calls OpenRouter** and costs money. **`--record`** implies `--live` and refreshes the
  recordings. Both need `OPENROUTER_API_KEY`.
- **It covers both halves of the pipeline** — the model stages via `runStagedParse`, and the
  deterministic half via the row builders exported from `health-structure/service.ts` (code
  resolution, `is_applied`, unit canonicalisation). Scoring only the stage output would miss every
  defect that lives after it.
- **Wrongful condition resolutions lead the report.** A missed resolution leaves a stale row a
  person can correct; a wrongful one silently closes a live condition in a patient's record. That
  asymmetry is never averaged into a single score.
- **Scores are never gated on** unless `--fail-under` is passed explicitly. A non-zero exit means a
  case failed to _run_, not that quality dropped.

CI never runs this on pull requests, deliberately: a scored run costs money per commit. The
`Extraction Eval` workflow is `workflow_dispatch` only — trigger it by hand from the Actions tab
when you want a report. It needs an `OPENROUTER_API_KEY` repository secret for `live` mode;
`cassette` mode needs no secret.

`ci-fast` is never a substitute for final pre-push validation on non-doc changes; final validation must include coverage gates.

## Stage-Based Execution Cadence

This section is the canonical source for when checks run during a task.

When a task changes files, apply checks by stage, not after every single edit.

- During each task stage that changes files:
  - select checks from **Change-Type Check Matrix** for files touched in that stage;
  - run scoped checks needed for quick confidence;
  - for non-doc stages, run `ci-fast` before moving to the next stage.
- Final stage before handoff for tasks with non-doc file changes:
  - run `dev` and verify clean boot;
  - run `ci` and require success.
- Coverage and flow enforcement (non-doc changes): `ci` is mandatory and includes `test-unit-coverage`, `coverage-check`, and `test-e2e`; do not duplicate those commands unless debugging a failing lane.
- Docs-only tasks:
  - use docs checks from the matrix and skip `ci` unless full validation is explicitly requested.

Automation and agent skills must reference this section and the matrix instead of duplicating their content.

## Canonical Command Policy

Use command IDs from **AGENTS.md**; do not invent ad-hoc alternatives when an equivalent ID exists. IDs referenced in this document: `dev`, `ci`, `ci-fast`, `test-e2e`, `quality`, `secrets-preflight`, `db-lint`, `db-test`, `db-run`, `db-reset`. Full list: **AGENTS.md** and `just --list --unsorted`.

## Local stack reuse (agents and parallel runs)

When running **`ci`**, **`ci-verify-local`**, or any recipe that runs **`build-local-all`** in an environment where the Supabase stack may already be running (e.g. another agent, a long-lived **`dev`** session, or a previously started stack), set **`SUPABASE_ALREADY_RUNNING=1`** so the script does not start or stop the stack. This avoids:

- Parallel agents interfering (one stopping the stack the other is using),
- Wasted time on redundant start/stop when a full redeploy is not needed.

**Use the flag when:**

- The stack is already up and no DB schema or deploy SQL changes are required for the current task, or
- DB changes will be applied separately (see below).

**When the task requires applying DB changes** (migrations or `supabase/db` deploy SQL), apply them explicitly instead of relying only on a full stack restart:

- Ensure the stack is running (**`supabase-local-start`** or **`dev`**), then run **`db-run`** (non-destructive: migrations + deploy SQL) or **`db-reset`** (destructive: reset then migrations + deploy SQL) as needed. Then run **`ci`** or **`ci-verify-local`** with **`SUPABASE_ALREADY_RUNNING=1`** so the run reuses the stack and does not stop it.
- Alternatively, run **`ci`** / **`ci-verify-local`** without the flag so the stack is started, **`supabase-local-reset-and-deploy`** runs inside **`build-local-all`**, and the stack is stopped after the run (single-runner or when no other process needs the stack).

Command IDs: **`db-run`**, **`db-reset`** (see **AGENTS.md**).

## Test Impact Policy

Every behavior change must update tests in the same change set.

- If app/extension/script/edge behavior changes, add or update unit tests in the corresponding runtime lane (`test-unit-web`, `test-unit-ext`, `test-unit-node`, `test-unit-functions`).
- If a user-facing flow changes (especially record processing/extraction), add or update Playwright coverage and run `test-e2e` in the same change set.
- If SQL function/policy behavior changes under `supabase/migrations/` or `supabase/db/`, add or update pgTAP tests under `supabase/tests/`.
- Keep `supabase/tests/coverage-map.json` current when DB object naming does not map cleanly to pgTAP test file names.
- If no automated test change is required, include an explicit rationale in PR evidence (`why-no-test-change` note).

## Extension Release Policy

`browserExtension/manifest.json` `version` is the canonical Chrome extension release version.

- When packaged extension surfaces change, the same change set must bump `browserExtension/manifest.json` `version`.
- Packaged extension surfaces are:
  - `browserExtension/**`
  - `scripts/extension/**`
  - `vite.config.extension.ts`
- CI enforces the rule with `extension-release-check-version`.
- When the manifest version changes, build the release bundle with `extension-release-build`.
- Production publication uses `extension-release-publish` and updates the public `extension-releases` bucket metadata consumed by the web app.

## Change-Type Check Matrix

For most code changes, **`ci`** satisfies static/build and test requirements; add the extra checks below when applicable.

| Change Type                            | Mandatory Checks                                                      | Additional Checks                                                                                                 | Evidence Required                              |
| -------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Task registry only (`docs/tasks/**`)   | `quality-tasks`                                                       | none — CI skips build, e2e, unit and coverage lanes for this change type                                          | `tasks-check` output                           |
| Docs only                              | `lint` (if touched TS/JS snippets only), docs links check             | none                                                                                                              | list of changed docs and cross-links validated |
| UI/routes/components                   | `dev` + `ci`                                                          | run `test-e2e` when route participates in user processing flows; manual happy-path walkthrough on affected routes | command outcomes + screenshots/recording       |
| Hooks/client orchestration             | `dev` + `ci`                                                          | run `test-e2e` when hook affects end-to-end user flows; walkthrough for stale cache/mutation behavior             | command outcomes + brief behavior notes        |
| Edge/API workflow                      | `dev` + `ci`                                                          | verify auth behavior and error path handling; run `test-e2e` for user-triggered workflows                         | command outcomes + endpoint behavior notes     |
| DB schema/policy/function/trigger/cron | `dev` + `ci` + `db-lint`, `db-test`, `db-run` or `db-reset` as needed | verify migration + `supabase/db` parity                                                                           | command outcomes + SQL diff rationale          |
| Extension/service worker/import flow   | `dev` + `ci`                                                          | extension bridge/manual import scenario                                                                           | command outcomes + scenario transcript         |
| Scripts/tooling                        | `dev` + `ci`                                                          | verify CLI behavior and error handling                                                                            | command outcomes + command transcript          |
| CI/deploy/security config              | `dev` + `ci`, `secrets-preflight`                                     | check workflow/job behavior and required env contracts                                                            | command outcomes + config review notes         |

## How To Check Quality (Execution + Validation)

### 1. Static and build gates

Run **`ci`** from the repository root for full verification (or **`ci-fast`** for quick iteration without Supabase/coverage). `ci` runs `quality`, then `build-local-all`, `test-unit-coverage`, `coverage-check`, and `test-e2e`.

Pass criteria: all steps exit successfully; coverage thresholds and ratchets are enforced (zero format drift, zero lint/type issues, unit and coverage checks pass, smoke build succeeds).

#### Reference: per-step pass criteria

- Format: zero drift. Lint: zero warnings/errors (web, extension, scripts, Supabase functions). Types: no TS/Deno diagnostics.
- Unit tests: all runtime-split suites pass. Coverage: artifacts under `coverage/` and `.coverage/deno/`; `src/**` and per-function aggregates at `>=75%` lines/branches; ratchet and DB object mapping enforced.
- E2E product flows: Playwright suites pass against local Supabase. For extraction-related suites, `HEALTH_STRUCTURE_PARSER_MODE=e2e_stub` must be active, validating happy and failure paths without external LLM calls.
- Smoke: production build and static generation succeed.

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

Visual evidence is mandatory at handoff: every change set that touches a user-visible surface must deliver screenshots of the delivered result with the final response, and change sets with no visible surface must say so explicitly with a reason. Capture, naming, and delivery rules live in the `change-review-screenshots` skill (`.agents/skills/change-review-screenshots`).

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
