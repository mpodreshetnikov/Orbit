#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SUMMARY_PATH = path.join(REPO_ROOT, "coverage", "combined-summary.json");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "just", "coverage-baseline.json");

const TRACKED_METRICS = [
  "vitest.lines_pct",
  "vitest.branches_pct",
  "deno.lines_pct",
  "deno.branches_pct",
  "surfaces.web.instrumented_ratio_pct",
  "surfaces.supabase_functions.instrumented_ratio_pct",
  "db.totals.function_mapping_ratio_pct",
  "db.totals.policy_mapping_ratio_pct",
];

const MINIMUM_TARGETS = {
  "vitest.lines_pct": 75,
  "deno.lines_pct": 75,
  "db.totals.function_mapping_ratio_pct": 75,
  "db.totals.policy_mapping_ratio_pct": 75,
};

function getByPath(source, dotPath) {
  return dotPath.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeBaseline(summary) {
  const metrics = {};
  for (const metric of TRACKED_METRICS) {
    metrics[metric] = Number(getByPath(summary, metric) || 0);
  }
  const baseline = {
    generated_at: new Date().toISOString(),
    metrics,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`[coverage-ratchet] baseline updated: ${path.relative(REPO_ROOT, BASELINE_PATH).replace(/\\/g, "/")}`);
}

function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const enforceBaseline = process.argv.includes("--enforce-baseline");
  const summary = loadJson(SUMMARY_PATH);

  if (!summary) {
    console.error("[coverage-ratchet] missing coverage/combined-summary.json; run coverage-report first");
    process.exit(1);
  }

  if (updateBaseline) {
    writeBaseline(summary);
    return;
  }

  const failures = [];
  if (enforceBaseline) {
    const baseline = loadJson(BASELINE_PATH);
    if (!baseline || !baseline.metrics) {
      console.error("[coverage-ratchet] missing baseline; run coverage-ratchet --update-baseline");
      process.exit(1);
    }

    for (const [metric, baselineValue] of Object.entries(baseline.metrics)) {
      const currentValue = Number(getByPath(summary, metric) || 0);
      if (Number.isNaN(currentValue)) {
        failures.push(`${metric}: current value is not numeric`);
        continue;
      }
      if (currentValue + 0.0001 < Number(baselineValue)) {
        failures.push(`${metric}: ${currentValue} < baseline ${baselineValue}`);
      }
    }
  }

  for (const [metric, minimumValue] of Object.entries(MINIMUM_TARGETS)) {
    const currentValue = Number(getByPath(summary, metric) || 0);
    if (Number.isNaN(currentValue)) {
      failures.push(`${metric}: current value is not numeric`);
      continue;
    }
    if (currentValue + 0.0001 < Number(minimumValue)) {
      failures.push(`${metric}: ${currentValue} < target ${minimumValue}`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[coverage-ratchet] ${failure}`);
    }
    process.exit(1);
  }

  if (enforceBaseline) {
    console.log("[coverage-ratchet] coverage is >= baseline and minimum targets");
    return;
  }
  console.log("[coverage-ratchet] coverage meets minimum targets");
}

main();
