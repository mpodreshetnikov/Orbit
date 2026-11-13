#!/usr/bin/env node
/**
 * Run Stryker in incremental (changed files) or full mode.
 *
 * Usage:
 *   node scripts/just/run-mutation.cjs              # incremental vs STRYKER_BASE / origin/main
 *   node scripts/just/run-mutation.cjs --full       # full Vitest mutate surface
 *   node scripts/just/run-mutation.cjs --baseline   # critical-path mutate set for a quick score
 *
 * Never part of `quality` / `ci-fast` / PR Quality Gates. Exit 0 even when score is low
 * (thresholds.break is null); non-zero only when Stryker itself fails to run.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const full = args.includes("--full");
const baseline = args.includes("--baseline");

// Vitest-covered critical paths only. Deno categorize/window and SQL RPCs are
// closed with Deno/pgTAP tests (Stryker has no Deno runner here).
const BASELINE_MUTATE = [
  "src/lib/mcp/money/transactions.ts",
  "src/lib/mcp/money/spend-draft.ts",
  "src/lib/mcp/apps/spend-draft-page.ts",
  "src/lib/mcp/apps/category-draft-page.ts",
  "src/lib/mcp/apps/checkup-draft-page.ts",
  "src/lib/mcp/apps/record-draft-page.ts",
  "scripts/just/participants.cjs",
];

function changedFiles(baseRef) {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "git diff failed");
    process.exit(result.status ?? 1);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isMutable(file) {
  if (!/\.(ts|tsx|js|cjs|mjs)$/.test(file)) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(file) || /_test\.ts$/.test(file)) return false;
  if (file.startsWith("mobile/") || file.startsWith("e2e/") || file.startsWith("ios/"))
    return false;
  if (file.startsWith("supabase/db/") || file.startsWith("supabase/migrations/")) return false;
  if (file.startsWith("supabase/tests/")) return false;
  // Deno edge sources are listed for baseline awareness but Stryker cannot run Deno tests;
  // skip them in incremental Vitest mode unless they are under a Vitest project (they are not).
  if (file.startsWith("supabase/functions/")) return false;
  return (
    file.startsWith("src/") ||
    file.startsWith("browserExtension/") ||
    file.startsWith("scripts/") ||
    file.startsWith("native/")
  );
}

function resolveMutate() {
  if (full) return null; // use stryker.config.mjs mutate globs
  if (baseline) return BASELINE_MUTATE.filter((file) => fs.existsSync(path.join(root, file)));

  const base = process.env.STRYKER_BASE || "origin/main";
  const files = changedFiles(base).filter(isMutable);
  if (files.length === 0) {
    console.log(`run-mutation: no mutable Vitest-covered files changed vs ${base}; skipping.`);
    writeSkipReport(base);
    process.exit(0);
  }
  return files;
}

function writeSkipReport(base) {
  const dir = path.join(root, "reports/mutation");
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    schemaVersion: 1,
    mode: "incremental-skip",
    base,
    generatedAt: new Date().toISOString(),
    mutationScore: null,
    files: [],
    note: "No mutable Vitest-covered files in the diff; Stryker was not run.",
  };
  fs.writeFileSync(
    path.join(dir, "mutation-summary.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function writeSummaryFromStrykerJson() {
  const reportPath = path.join(root, "reports/mutation/mutation.json");
  const summaryPath = path.join(root, "reports/mutation/mutation-summary.json");
  if (!fs.existsSync(reportPath)) return;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const files = report.files ? Object.keys(report.files) : [];
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let timeout = 0;
  let runtimeErrors = 0;
  let ignored = 0;
  for (const file of Object.values(report.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      switch (mutant.status) {
        case "Killed":
          killed += 1;
          break;
        case "Survived":
          survived += 1;
          break;
        case "NoCoverage":
          noCoverage += 1;
          break;
        case "Timeout":
          timeout += 1;
          break;
        case "RuntimeError":
        case "CompileError":
          runtimeErrors += 1;
          break;
        case "Ignored":
          ignored += 1;
          break;
        default:
          break;
      }
    }
  }
  // Match Stryker: ignored mutants are out of the denominator.
  const totalMutants = killed + survived + noCoverage + timeout + runtimeErrors;
  const detected = killed + timeout;
  const score = totalMutants > 0 ? Math.round((10000 * detected) / totalMutants) / 100 : null;
  const covered = killed + survived + timeout + runtimeErrors;
  const coveredScore = covered > 0 ? Math.round((10000 * detected) / covered) / 100 : null;
  const payload = {
    schemaVersion: 1,
    mode: full ? "full" : baseline ? "baseline" : "incremental",
    generatedAt: new Date().toISOString(),
    mutationScore: score,
    mutationScoreCovered: coveredScore,
    killed,
    survived,
    noCoverage,
    timeout,
    runtimeErrors,
    ignored,
    totalMutants,
    files,
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `run-mutation: wrote ${path.relative(root, summaryPath)} (score=${score}, covered=${coveredScore})`,
  );
}

const mutate = resolveMutate();
const strykerArgs = ["stryker", "run"];
if (mutate) {
  // One --mutate with a comma-separated glob list — repeated flags were collapsing to a single file.
  strykerArgs.push("--mutate", mutate.join(","));
  console.log(`run-mutation: mutating ${mutate.length} file(s):\n  ${mutate.join("\n  ")}`);
} else {
  console.log("run-mutation: full mutate surface from stryker.config.mjs");
}

const result = spawnSync("npx", strykerArgs, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TZ: process.env.TZ || "Asia/Krasnoyarsk" },
});

writeSummaryFromStrykerJson();

if (result.status !== 0) {
  console.error("run-mutation: Stryker exited non-zero (runner/setup failure).");
  process.exit(result.status ?? 1);
}
process.exit(0);
