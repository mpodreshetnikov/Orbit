#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LCOV_PATH = path.join(REPO_ROOT, ".coverage", "deno", "lcov.info");
const MIN_LINES_PCT = 75;
const MIN_BRANCHES_PCT = 75;
const FUNCTION_DIRS = [
  "health-ocr",
  "health-structure",
  "icd-lookup",
  "money-import",
  "notifications-cron",
];

function fail(message) {
  console.error(`[supabase-function-coverage-threshold] ${message}`);
  process.exit(1);
}

function normalizePath(input) {
  return input.replace(/\\/g, "/").toLowerCase();
}

function pct(covered, total) {
  if (!total) return 100;
  return (covered / total) * 100;
}

function formatPct(value) {
  return value.toFixed(2);
}

function parseLcovRecords(content) {
  const records = [];
  let current = null;

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      current = {
        sf: normalizePath(line.slice(3)),
        lf: 0,
        lh: 0,
        brf: 0,
        brh: 0,
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("LF:")) {
      current.lf = Number(line.slice(3)) || 0;
      continue;
    }

    if (line.startsWith("LH:")) {
      current.lh = Number(line.slice(3)) || 0;
      continue;
    }

    if (line.startsWith("BRF:")) {
      current.brf = Number(line.slice(4)) || 0;
      continue;
    }

    if (line.startsWith("BRH:")) {
      current.brh = Number(line.slice(4)) || 0;
      continue;
    }

    if (line === "end_of_record") {
      records.push(current);
      current = null;
    }
  }

  return records;
}

function mergeByFile(records) {
  const merged = new Map();

  for (const record of records) {
    const prev = merged.get(record.sf);
    if (!prev) {
      merged.set(record.sf, { ...record });
      continue;
    }

    merged.set(record.sf, {
      sf: record.sf,
      lf: Math.max(prev.lf, record.lf),
      lh: Math.max(prev.lh, record.lh),
      brf: Math.max(prev.brf, record.brf),
      brh: Math.max(prev.brh, record.brh),
    });
  }

  return merged;
}

function isIncludedSourceFile(sf) {
  if (!sf.includes("/supabase/functions/")) return false;
  if (sf.includes("/supabase/functions/_shared/")) return false;
  if (sf.endsWith("/index.ts")) return false;
  if (sf.endsWith("_test.ts")) return false;
  if (sf.endsWith(".d.ts")) return false;
  return true;
}

function aggregateByFunction(recordsByFile) {
  const aggregates = Object.fromEntries(
    FUNCTION_DIRS.map((name) => [name, { lf: 0, lh: 0, brf: 0, brh: 0, files: 0 }]),
  );

  for (const record of recordsByFile.values()) {
    if (!isIncludedSourceFile(record.sf)) continue;

    const fnName = FUNCTION_DIRS.find((name) => record.sf.includes(`/supabase/functions/${name}/`));
    if (!fnName) continue;

    const agg = aggregates[fnName];
    agg.lf += record.lf;
    agg.lh += record.lh;
    agg.brf += record.brf;
    agg.brh += record.brh;
    agg.files += 1;
  }

  return aggregates;
}

function main() {
  if (!fs.existsSync(LCOV_PATH)) {
    fail("missing .coverage/deno/lcov.info; run `just test-unit-coverage` first.");
  }

  const content = fs.readFileSync(LCOV_PATH, "utf8");
  const records = parseLcovRecords(content);
  if (records.length === 0) {
    fail("no LCOV records found in .coverage/deno/lcov.info.");
  }

  const mergedByFile = mergeByFile(records);
  const aggregates = aggregateByFunction(mergedByFile);

  const failures = [];

  for (const fnName of FUNCTION_DIRS) {
    const agg = aggregates[fnName];
    if (!agg || agg.files === 0) {
      failures.push(`${fnName}: no included source files found`);
      continue;
    }

    const linesPct = pct(agg.lh, agg.lf);
    const branchesPct = pct(agg.brh, agg.brf);

    console.log(
      `[supabase-function-coverage-threshold] ${fnName} lines=${formatPct(linesPct)}% (${agg.lh}/${agg.lf})`,
    );
    console.log(
      `[supabase-function-coverage-threshold] ${fnName} branches=${formatPct(branchesPct)}% (${agg.brh}/${agg.brf})`,
    );

    if (linesPct + 0.0001 < MIN_LINES_PCT) {
      failures.push(`${fnName}: lines ${formatPct(linesPct)}% < ${MIN_LINES_PCT}%`);
    }

    if (branchesPct + 0.0001 < MIN_BRANCHES_PCT) {
      failures.push(`${fnName}: branches ${formatPct(branchesPct)}% < ${MIN_BRANCHES_PCT}%`);
    }
  }

  if (failures.length > 0) {
    fail(`threshold failures:\n- ${failures.join("\n- ")}`);
  }

  console.log(
    `[supabase-function-coverage-threshold] passed: all Supabase functions lines>=${MIN_LINES_PCT}% and branches>=${MIN_BRANCHES_PCT}%`,
  );
}

main();
