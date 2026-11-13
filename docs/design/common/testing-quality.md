# High-signal unit tests, coverage, and mutation

Canonical policy for agent-authored Vitest (and related) unit tests. Skills and `AGENTS.md` link
here; they must not restate thresholds.

## Why

Line/branch coverage proves a line ran. It does not prove a realistic fault would fail a test.
Orbit agents write most of the suite, so weak oracles (presence checks, leaky mocks, substring-only
HTML asserts) are a standing failure mode.

## High-signal rules

- Prefer one behavioural assertion with an independent expected value (requirement, schema, or
  shared fixture) over many structural ones.
- Mock at I/O boundaries only (Supabase, fetch, LLM). Never mock the module under test; never use
  mock call order alone as proof of a business rule.
- Do not use as the primary oracle: `toBeTruthy` / `toBeDefined` / lone `toContain` on markup or
  free text; `toHaveBeenCalled*` without a result assertion.
- Pure functions: table-driven examples plus optional `fast-check` properties with explicit ranges.
  Pilots: `src/lib/mcp/zoned-time.property.test.ts`, `src/lib/money/rule-filter-text.property.test.ts`.
- Dual SQL/TS rules: `docs/design/common/sql-ts-parity.md`.
- Smell scan: command ID `test-smell-lint` (warn by default; `ORBIT_TEST_SMELL_FAIL=1` to gate).
  Suppress only with `// test-smell-ok: <reason>` on the expect line. Do not add new smells.

## Coverage floor

- Web / unit lanes today: **≥75%** lines and branches (`src-coverage-threshold` / `coverage-check`).
  See also the pass criteria in `docs/QUALITY.md`.
- Raising the floor to **80%** is tracked separately (`T-261113-tww` / ORB-64) and must wait until
  mutation survivors shrink — do not pad weak tests only to hit a higher floor.

## Mutation (`test-mutation`)

When `test-mutation` is available on the tree:

- It is **required** before claiming test work done on Vitest-covered surfaces.
- Hard threshold: **`mutationScoreCovered` = 100%** — every mutant on lines already covered by
  tests must be killed.
- Uncovered lines are **not** held to that 100% killed bar; they are limited by the coverage floor
  above (75% now; 80% after `T-261113-tww`).
- There is **no** advisory mutation lane, **no** nightly/full side run, and **no** separate
  baseline/full command IDs to prefer over `test-mutation`.
- Do not treat `coverage-check` green alone as proof. Report survivors on covered lines if any.

## Related

- Quality gates and cadence: `docs/QUALITY.md`
- SQL ↔ TS parity recipe: `docs/design/common/sql-ts-parity.md`
- Command IDs: `AGENTS.md` (`test-smell-lint`, `coverage-check`, `test-mutation` when listed)
