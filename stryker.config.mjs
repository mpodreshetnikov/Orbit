/**
 * Stryker mutation testing for Vitest-covered JS/TS surfaces (T-261113-qgz).
 *
 * Scope: every module that Vitest exercises (src/, browserExtension/, scripts/, native/).
 * Out of scope here (documented in docs/design/common/mutation-testing.md):
 *   - Deno Edge Functions (`*_test.ts` under supabase/functions) — no Stryker Deno runner
 *   - pgTAP SQL under supabase/tests — not JS/TS
 *   - mobile/ Jest-expo package — separate package; use its own lane later
 *
 * Modes (see just recipes):
 *   - incremental (default CI/local): mutate only files changed vs base branch
 *   - full: mutate the full Vitest surface (slow; baseline / scheduled)
 * Thresholds do not break CI — reports are advisory until a ratchet is agreed.
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
  ignorePatterns: [
    "coverage",
    ".coverage",
    ".stryker-tmp",
    "reports",
    "mobile",
    "supabase/functions",
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
    // Advisory baseline: never fail the fast PR gate. Raise later via ratchet.
    high: 80,
    low: 60,
    break: null,
  },
  timeoutMS: 60_000,
  concurrency: 4,
  dryRunTimeoutMinutes: 15,
  disableBail: false,
  cleanTempDir: true,
};

export default config;
