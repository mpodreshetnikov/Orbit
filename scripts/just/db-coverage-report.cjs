#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MAP_PATH = path.join(REPO_ROOT, "supabase", "tests", "coverage-map.json");

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${normalizePath(path.relative(REPO_ROOT, filePath))}: ${error.message}`);
  }
}

function listSqlFiles(relativeDir) {
  const absDir = path.join(REPO_ROOT, relativeDir);
  if (!fs.existsSync(absDir)) {
    return [];
  }

  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => normalizePath(path.join(relativeDir, entry.name)));
}

function changedFilesFromGit() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // format: XY path OR XY old -> new
      const payload = line.slice(3);
      if (payload.includes(" -> ")) {
        return payload.split(" -> ")[1];
      }
      return payload;
    })
    .map((filePath) => normalizePath(filePath));
}

function resolveTests({
  kind,
  filePath,
  map,
  availableTests,
}) {
  const rel = normalizePath(filePath);
  const fileName = path.basename(rel, ".sql");
  const mapForKind = map[kind] || {};

  const fromMap =
    mapForKind[rel] ||
    mapForKind[fileName] ||
    mapForKind[normalizePath(path.relative("supabase/db", rel))] ||
    [];

  if (Array.isArray(fromMap) && fromMap.length > 0) {
    return {
      tests: fromMap.map((value) => normalizePath(value)),
      source: "map",
    };
  }

  const candidates = [];
  if (kind === "functions") {
    candidates.push(`supabase/tests/functions/${fileName}_test.sql`);
    candidates.push(`supabase/tests/functions/${fileName.replace(/^_+/, "")}_test.sql`);
  }
  if (kind === "policies") {
    candidates.push(`supabase/tests/policies/${fileName}_test.sql`);
    candidates.push(`supabase/tests/policies/${fileName}_rls_test.sql`);
  }

  const tests = candidates.filter((candidate) => availableTests.has(candidate));
  return {
    tests,
    source: tests.length > 0 ? "fallback" : "none",
  };
}

function collectDbCoverage(options = {}) {
  const strictAll = Boolean(options.strictAll);
  const strictChanged = Boolean(options.strictChanged);

  const map = readJson(MAP_PATH, { functions: {}, policies: {} });
  const dbFunctionFiles = listSqlFiles("supabase/db/functions");
  const dbPolicyFiles = listSqlFiles("supabase/db/policies");
  const functionTests = listSqlFiles("supabase/tests/functions");
  const policyTests = listSqlFiles("supabase/tests/policies");
  const availableTests = new Set([...functionTests, ...policyTests]);

  const functionRecords = dbFunctionFiles.map((filePath) => {
    const resolved = resolveTests({
      kind: "functions",
      filePath,
      map,
      availableTests,
    });
    return {
      file: filePath,
      tests: resolved.tests,
      source: resolved.source,
    };
  });

  const policyRecords = dbPolicyFiles.map((filePath) => {
    const resolved = resolveTests({
      kind: "policies",
      filePath,
      map,
      availableTests,
    });
    return {
      file: filePath,
      tests: resolved.tests,
      source: resolved.source,
    };
  });

  const changedFiles = changedFilesFromGit();
  const changedDbObjects = changedFiles.filter(
    (filePath) =>
      filePath.startsWith("supabase/db/functions/") || filePath.startsWith("supabase/db/policies/"),
  );

  const functionUnmapped = functionRecords.filter((record) => record.tests.length === 0).map((record) => record.file);
  const policyUnmapped = policyRecords.filter((record) => record.tests.length === 0).map((record) => record.file);

  const changedUnmapped = changedDbObjects.filter((filePath) => {
    const byFunction = functionRecords.find((record) => record.file === filePath);
    if (byFunction) return byFunction.tests.length === 0;
    const byPolicy = policyRecords.find((record) => record.file === filePath);
    if (byPolicy) return byPolicy.tests.length === 0;
    return true;
  });

  const mapEntries = [
    ...Object.values(map.functions || {}).flat(),
    ...Object.values(map.policies || {}).flat(),
  ]
    .map((entry) => normalizePath(entry))
    .filter(Boolean);

  const missingMappedTests = Array.from(new Set(mapEntries)).filter(
    (entry) => !availableTests.has(entry),
  );

  const summary = {
    generated_at: new Date().toISOString(),
    totals: {
      db_functions: dbFunctionFiles.length,
      db_policies: dbPolicyFiles.length,
      function_tests: functionTests.length,
      policy_tests: policyTests.length,
      mapped_db_functions: dbFunctionFiles.length - functionUnmapped.length,
      mapped_db_policies: dbPolicyFiles.length - policyUnmapped.length,
      function_mapping_ratio_pct:
        dbFunctionFiles.length === 0
          ? 100
          : Number((((dbFunctionFiles.length - functionUnmapped.length) / dbFunctionFiles.length) * 100).toFixed(2)),
      policy_mapping_ratio_pct:
        dbPolicyFiles.length === 0
          ? 100
          : Number((((dbPolicyFiles.length - policyUnmapped.length) / dbPolicyFiles.length) * 100).toFixed(2)),
    },
    changed: {
      db_objects: changedDbObjects,
      unmapped: changedUnmapped,
    },
    unmapped: {
      functions: functionUnmapped,
      policies: policyUnmapped,
    },
    map: {
      missing_test_files: missingMappedTests,
    },
  };

  const errors = [];
  if (missingMappedTests.length > 0) {
    errors.push(
      `coverage-map references missing test files: ${missingMappedTests.join(", ")}`,
    );
  }
  if (strictAll && (functionUnmapped.length > 0 || policyUnmapped.length > 0)) {
    errors.push(
      `unmapped DB objects remain (functions: ${functionUnmapped.length}, policies: ${policyUnmapped.length})`,
    );
  }
  if (strictChanged && changedUnmapped.length > 0) {
    errors.push(`changed DB objects without mapped tests: ${changedUnmapped.join(", ")}`);
  }

  summary.errors = errors;
  return summary;
}

if (require.main === module) {
  const strictAll = process.argv.includes("--strict-all");
  const strictChanged = process.argv.includes("--strict-changed");
  const summary = collectDbCoverage({ strictAll, strictChanged });

  const coverageDir = path.join(REPO_ROOT, "coverage");
  fs.mkdirSync(coverageDir, { recursive: true });
  const outputPath = path.join(coverageDir, "db-coverage-summary.json");
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + "\n");

  console.log(`[db-coverage] functions mapped: ${summary.totals.mapped_db_functions}/${summary.totals.db_functions} (${summary.totals.function_mapping_ratio_pct}%)`);
  console.log(`[db-coverage] policies mapped: ${summary.totals.mapped_db_policies}/${summary.totals.db_policies} (${summary.totals.policy_mapping_ratio_pct}%)`);
  if (summary.changed.db_objects.length > 0) {
    console.log(`[db-coverage] changed DB objects: ${summary.changed.db_objects.length}`);
  }
  if (summary.errors.length > 0) {
    for (const error of summary.errors) {
      console.error(`[db-coverage] ${error}`);
    }
    process.exit(1);
  }
  console.log(`[db-coverage] summary written to ${normalizePath(path.relative(REPO_ROOT, outputPath))}`);
}

module.exports = {
  collectDbCoverage,
};

