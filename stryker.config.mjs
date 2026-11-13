/**
 * Stryker mutation testing for Vitest-covered JS/TS surfaces (T-261113-qgz).
 *
 * Scope: every module that Vitest exercises (src/, browserExtension/, scripts/, native/).
 * Out of scope here (documented in docs/design/common/mutation-testing.md):
 *   - Deno Edge Functions (`*_test.ts` under supabase/functions) — no Stryker Deno runner
 *   - pgTAP SQL under supabase/tests — not JS/TS
 *   - mobile/ Jest-expo package — separate package; use its own lane later
 *
 * Mode: incremental only (`just test-mutation` vs STRYKER_BASE / origin/main).
 * Required Quality Gates step. Stryker thresholds.break is null (overall score
 * includes NoCoverage); Orbit enforces mutationScoreCovered === 100 in run-mutation.cjs.
 */
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  packageManager: "npm",
  testRunner: "vitest",
  // No typescript-checker: scripts/**/*.cjs are mutated but sit outside tsconfig watchers.
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.config.ts",
    related: true,
  },
  mutate: [
    "src/**/*.{ts,tsx}",
    "browserExtension/**/*.{ts,tsx}",
    "scripts/**/*.{ts,js,cjs,mjs}",
    "native/**/*.{ts,tsx}",
    "!**/*.{test,spec}.{ts,tsx}",
    "!**/*_test.ts",
    "!**/*.d.ts",
    "!**/database.types.ts",
  ],
  ignoreStatic: true,
  // StringLiteral mutants only rewrite log/CLI message text; they do not change
  // control flow. Exclude them so the covered gate measures behavioral mutants.
  mutator: {
    excludedMutations: ["StringLiteral"],
  },
  // Do not ignore supabase/functions: Vitest parity tests (e.g. ocr-failure.test.ts)
  // read Edge Function sources from disk. mutate globs already omit that tree.
  ignorePatterns: [
    "coverage",
    ".coverage",
    ".stryker-tmp",
    "reports",
    "mobile",
    "e2e",
    "ios",
    "dist",
    ".next",
    "node_modules",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    // Advisory bands only. break is null because Stryker's break uses overall
    // mutationScore (incl. NoCoverage). Orbit's hard gate is mutationScoreCovered
    // via scripts/just/mutation-summary.cjs → evaluateCoveredMutationGate.
    high: 100,
    low: 100,
    break: null,
  },
  timeoutMS: 60_000,
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  disableBail: false,
  cleanTempDir: true,
};

export default config;
