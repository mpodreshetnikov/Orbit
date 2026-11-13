# Mutation testing (Stryker)

Canonical for how Orbit runs mutation testing on JS/TS unit surfaces, and what is out of scope.

## Commands

| ID              | Recipe               | Role                                                                                                       |
| --------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `test-mutation` | `just test-mutation` | Incremental: mutate Vitest-covered files changed vs `STRYKER_BASE` (default `origin/main`). Required gate. |

No baseline/full recipes. For a one-off full-surface run, invoke Stryker directly against `stryker.config.mjs` mutate globs — not a product command.

`test-mutation` is part of the PR **Quality Gates** job. Exit **0** (no-op) when the diff has no mutable Vitest-covered files.

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
- `reports/mutation/mutation-summary.json` — Orbit summary (`schemaVersion: 1`, `mode`, scores, counts, `files`)

Scores match Stryker Mutation Testing Elements (v8/v9):

- `mutationScore` = `(killed + timeout) / (killed + survived + noCoverage + timeout)`
- `mutationScoreCovered` = `(killed + timeout) / (killed + survived + timeout)`

`Ignored` and invalid (`RuntimeError` / `CompileError`) stay diagnostic-only (out of both denominators).

`reports/mutation/` is gitignored.

## Thresholds / gate

Stryker `thresholds.break` is **null**. Stryker’s own break uses overall `mutationScore`, which counts `NoCoverage` against the score — that would force every line to be covered by a test just to pass mutation, overlapping the line-coverage floor (75% now; ORB-64 → 80%).

Orbit’s hard Quality Gates check is in `scripts/just/mutation-summary.cjs` → `evaluateCoveredMutationGate` (invoked by `scripts/just/run-mutation.cjs` after Stryker JSON is written). Unit tests: `mutation-summary.test.ts`, `run-mutation.test.ts`.

- **Pass** when `mutationScoreCovered === 100` (equivalently: `survived === 0` on covered mutants).
- **Pass** on incremental skip (no mutable Vitest files in the diff).
- **NoCoverage** mutants do not fail the mutation gate (line-coverage floors own that: 75% now; ORB-64 → 80%).

`stryker.config.mjs` sets `thresholds.break: null` and excludes `StringLiteral` mutants (log/CLI message text only). Use `// Stryker disable next-line` only for proven equivalent or unreachable behavioral mutants, with a short reason.

## Timezone

Mutation and unit lanes default `TZ=Asia/Krasnoyarsk` (owner locale; no DST) so date formatting tests match CI. Unit recipes go through `scripts/just/run-vitest.cjs`, which sets `TZ` and spawns Node against the local Vitest CLI (no shell/`cmd.exe`) so the default works under just's Windows PowerShell shell as well as POSIX.
