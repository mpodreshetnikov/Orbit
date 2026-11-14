#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const COVERAGE_SUMMARY_PATH = path.join(REPO_ROOT, "coverage", "coverage-summary.json");
const MIN_LINES_PCT = 80;
const MIN_BRANCHES_PCT = 80;

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

function isSrcEntry(key, repoRoot = REPO_ROOT) {
  const relativePath = path.isAbsolute(key) ? path.relative(repoRoot, key) : key;
  const normalized = normalizePath(relativePath);
  return normalized.startsWith("src/");
}

function pct(covered, total) {
  if (!total) return 100;
  return (covered / total) * 100;
}

function formatPct(value) {
  return value.toFixed(2);
}

/**
 * @param {Record<string, any>} summary
 * @param {string} [repoRoot]
 * @returns {{ ok: true, linePct: number, branchPct: number, linesCovered: number, linesTotal: number, branchesCovered: number, branchesTotal: number } | { ok: false, message: string }}
 */
function evaluateSrcCoverage(summary, repoRoot = REPO_ROOT) {
  // "total" is not under src/, so isSrcEntry already drops the istanbul rollup key.
  const entries = Object.entries(summary).filter(([key]) => isSrcEntry(key, repoRoot));

  if (entries.length === 0) {
    return { ok: false, message: "no src/** coverage entries found in coverage-summary.json." };
  }

  let linesCovered = 0;
  let linesTotal = 0;
  let branchesCovered = 0;
  let branchesTotal = 0;

  for (const [, metrics] of entries) {
    linesCovered += metrics?.lines?.covered ?? 0;
    linesTotal += metrics?.lines?.total ?? 0;
    branchesCovered += metrics?.branches?.covered ?? 0;
    branchesTotal += metrics?.branches?.total ?? 0;
  }

  const linePct = pct(linesCovered, linesTotal);
  const branchPct = pct(branchesCovered, branchesTotal);

  if (linePct + 0.0001 < MIN_LINES_PCT) {
    return {
      ok: false,
      message: `lines threshold failed: ${formatPct(linePct)}% < ${MIN_LINES_PCT}%`,
    };
  }

  if (branchPct + 0.0001 < MIN_BRANCHES_PCT) {
    return {
      ok: false,
      message: `branches threshold failed: ${formatPct(branchPct)}% < ${MIN_BRANCHES_PCT}%`,
    };
  }

  return {
    ok: true,
    linePct,
    branchPct,
    linesCovered,
    linesTotal,
    branchesCovered,
    branchesTotal,
  };
}

function fail(message) {
  console.error(`[src-coverage-threshold] ${message}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(COVERAGE_SUMMARY_PATH)) {
    fail(
      "missing coverage/coverage-summary.json; run `just test-unit-coverage` before `just coverage-check`.",
    );
  }

  const summary = JSON.parse(fs.readFileSync(COVERAGE_SUMMARY_PATH, "utf8"));
  const result = evaluateSrcCoverage(summary);

  if (!result.ok) {
    fail(result.message);
  }

  console.log(
    `[src-coverage-threshold] src/** lines=${formatPct(result.linePct)}% (${result.linesCovered}/${result.linesTotal})`,
  );
  console.log(
    `[src-coverage-threshold] src/** branches=${formatPct(result.branchPct)}% (${result.branchesCovered}/${result.branchesTotal})`,
  );
  console.log(
    `[src-coverage-threshold] passed: lines>=${MIN_LINES_PCT}% and branches>=${MIN_BRANCHES_PCT}%`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  MIN_LINES_PCT,
  MIN_BRANCHES_PCT,
  isSrcEntry,
  pct,
  formatPct,
  evaluateSrcCoverage,
  main,
};
