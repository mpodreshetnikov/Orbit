# Mutation testing (Stryker)

Canonical for how Orbit runs mutation testing on JS/TS unit surfaces, and what is out of scope.

## Commands

| ID                       | Recipe                        | Role                                                                                                                                   |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `test-mutation`          | `just test-mutation`          | Incremental: mutate Vitest-covered files changed vs `STRYKER_BASE` (default `origin/main`).                                            |
| `test-mutation-baseline` | `just test-mutation-baseline` | Critical-path file set for a fast honest score (money compact/spend-draft, draft HTML, participants, categorize filters, cron window). |
| `test-mutation-full`     | `just test-mutation-full`     | Full Vitest mutate surface from `stryker.config.mjs` (slow).                                                                           |

None of these are part of `quality`, `ci-fast`, or the PR **Quality Gates** job. CI may run `test-mutation` as an **advisory** workflow that never blocks merge.

## Surfaces

**In scope (Stryker + Vitest):** `src/**`, `browserExtension/**`, `scripts/**`, `native/**` with co-located `*.test.ts(x)`.

**Out of scope for Stryker today:**

| Surface                 | Runner           | Why                                                                                                   |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `supabase/functions/**` | Deno.test        | No maintained Stryker Deno test runner; strengthen with Deno unit tests (operators, locked LLM path). |
| `supabase/tests/**`     | pgTAP            | SQL, not JS/TS; cover RPCs/filters with pgTAP (e.g. rule-filter parity, `mark_dose_taken` allowlist). |
| `mobile/**`             | Jest / jest-expo | Separate package; mutate lane deferred.                                                               |
| Playwright `e2e/`       | Playwright       | Flow tests, not unit mutation targets.                                                                |

## Reports / schema

Stryker writes:

- `reports/mutation/mutation.html` — human report
- `reports/mutation/mutation.json` — raw Stryker JSON
- `reports/mutation/mutation-summary.json` — Orbit summary (`schemaVersion: 1`, `mode`, `mutationScore`, counts, `files`)

Scores match Stryker: `Ignored` and invalid (`RuntimeError` / `CompileError`) mutants stay in diagnostic counts but are excluded from both score denominators.

`reports/mutation/` is gitignored except a committed baseline snapshot under `scripts/just/mutation-baseline.json` when a score is recorded.

## Thresholds

`stryker.config.mjs` sets `thresholds.break: null` so a low score never fails the fast PR gate. `high`/`low` are advisory bands only. A future ratchet (like coverage) needs an explicit task.

## Timezone

Mutation and unit lanes default `TZ=Asia/Krasnoyarsk` (owner locale; no DST) so date formatting tests match CI. Unit recipes go through `scripts/just/run-vitest.cjs` so the default works under just's Windows PowerShell shell as well as POSIX.
