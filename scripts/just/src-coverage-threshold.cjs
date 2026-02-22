#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const COVERAGE_SUMMARY_PATH = path.join(REPO_ROOT, "coverage", "coverage-summary.json");
const MIN_LINES_PCT = 75;
const MIN_BRANCHES_PCT = 75;

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

function isSrcEntry(key) {
  const normalized = normalizePath(key);
  return normalized.includes("/src/") || normalized.startsWith("src/");
}

function pct(covered, total) {
  if (!total) return 100;
  return (covered / total) * 100;
}

function formatPct(value) {
  return value.toFixed(2);
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
  const entries = Object.entries(summary).filter(([key]) => key !== "total" && isSrcEntry(key));

  if (entries.length === 0) {
    fail("no src/** coverage entries found in coverage-summary.json.");
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

  console.log(
    `[src-coverage-threshold] src/** lines=${formatPct(linePct)}% (${linesCovered}/${linesTotal})`,
  );
  console.log(
    `[src-coverage-threshold] src/** branches=${formatPct(branchPct)}% (${branchesCovered}/${branchesTotal})`,
  );

  if (linePct + 0.0001 < MIN_LINES_PCT) {
    fail(`lines threshold failed: ${formatPct(linePct)}% < ${MIN_LINES_PCT}%`);
  }

  if (branchPct + 0.0001 < MIN_BRANCHES_PCT) {
    fail(`branches threshold failed: ${formatPct(branchPct)}% < ${MIN_BRANCHES_PCT}%`);
  }

  console.log(
    `[src-coverage-threshold] passed: lines>=${MIN_LINES_PCT}% and branches>=${MIN_BRANCHES_PCT}%`,
  );
}

main();
