#!/usr/bin/env node
/**
 * Run Stryker incremental mutation vs STRYKER_BASE / origin/main.
 *
 * Usage: node scripts/just/run-mutation.cjs
 *
 * Required PR Quality Gates step (`just test-mutation`).
 * Hard gate: mutationScoreCovered === 100 (no survivors). NoCoverage is allowed.
 * Stryker thresholds.break is null (overall mutationScore includes NoCoverage).
 * Exit 0 when no mutable Vitest-covered files changed (no-op skip).
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { summarizeMutantStatuses, evaluateCoveredMutationGate } = require("./mutation-summary.cjs");

const root = path.resolve(__dirname, "../..");

/**
 * @param {{ base?: string }} [opts]
 * @param {Record<string, string | undefined>} [env]
 */
function resolveBase(opts = {}, env = process.env) {
  if (opts.base != null) return opts.base;
  return env.STRYKER_BASE || "origin/main";
}

/** @param {Record<string, string | undefined>} [env] */
function resolveTz(env = process.env) {
  return env.TZ || "Asia/Krasnoyarsk";
}

function gitDiffFailedMessage(result) {
  if (result.stderr) return result.stderr;
  if (result.stdout) return result.stdout;
  return "git diff failed";
}

function changedFiles(baseRef, spawn = spawnSync) {
  const result = spawn("git", ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(gitDiffFailedMessage(result));
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isMutable(file) {
  // Allowlist only: denylists for mobile/e2e/supabase would be equivalent mutants
  // (those paths already fail the prefixes below).
  if (!/\.(ts|tsx|js|cjs|mjs)$/.test(file)) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(file) || /_test\.ts$/.test(file)) return false;
  return (
    file.startsWith("src/") ||
    file.startsWith("browserExtension/") ||
    file.startsWith("scripts/") ||
    file.startsWith("native/")
  );
}

function resolveMutate(baseRef, spawn = spawnSync) {
  return changedFiles(baseRef, spawn).filter(isMutable);
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
    mutationScoreCovered: 100,
    survived: 0,
    files: [],
    note: "No mutable Vitest-covered files in the diff; Stryker was not run.",
  };
  fs.writeFileSync(
    path.join(dir, "mutation-summary.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  return payload;
}

function writeSummaryFromStrykerJson(fsModule = fs) {
  const reportPath = path.join(root, "reports/mutation/mutation.json");
  const summaryPath = path.join(root, "reports/mutation/mutation-summary.json");
  if (!fsModule.existsSync(reportPath)) return null;
  const report = JSON.parse(fsModule.readFileSync(reportPath, "utf8"));
  const files = report.files ? Object.keys(report.files) : [];
  const counts = summarizeMutantStatuses(report.files ?? {});
  const payload = {
    schemaVersion: 1,
    mode: "incremental",
    generatedAt: new Date().toISOString(),
    ...counts,
    files,
  };
  fsModule.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `run-mutation: wrote ${path.relative(root, summaryPath)} (score=${counts.mutationScore}, covered=${counts.mutationScoreCovered}, survived=${counts.survived})`,
  );
  return payload;
}

/**
 * @returns {number} exit code
 */
function runMutation(opts = {}) {
  const spawn = opts.spawn ?? spawnSync;
  const base = resolveBase(opts);
  let mutate;
  try {
    mutate = resolveMutate(base, spawn);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
  if (mutate.length === 0) {
    console.log(`run-mutation: no mutable Vitest-covered files changed vs ${base}; skipping.`);
    writeSkipReport(base);
    return 0;
  }

  const strykerArgs = ["stryker", "run", "--mutate", mutate.join(",")];
  console.log(`run-mutation: mutating ${mutate.length} file(s):\n  ${mutate.join("\n  ")}`);

  const result = spawn("npx", strykerArgs, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, TZ: resolveTz() },
  });

  const summary = writeSummaryFromStrykerJson();

  if (result.error) {
    return 2;
  }
  // Stryker thresholds.break is null; non-zero here is runner/setup failure.
  if (result.status == null) {
    return 1;
  }
  if (result.status !== 0) {
    return result.status;
  }

  const gate = evaluateCoveredMutationGate(summary);
  if (!gate.ok) {
    console.error(`run-mutation: ${gate.reason}`);
    return 1;
  }
  return 0;
}

module.exports = {
  changedFiles,
  isMutable,
  resolveMutate,
  resolveBase,
  resolveTz,
  gitDiffFailedMessage,
  runMutation,
  writeSkipReport,
  writeSummaryFromStrykerJson,
};

// Stryker disable next-line all: CLI entry — unreachable when the module is imported by tests
if (require.main === module) {
  process.exit(runMutation());
}
