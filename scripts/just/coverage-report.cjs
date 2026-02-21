#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { collectDbCoverage } = require("./db-coverage-report.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function toRepoRelative(filePath) {
  const normalized = normalizePath(filePath);
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/")) {
    return normalizePath(path.relative(REPO_ROOT, normalized));
  }
  return normalized;
}

function parseLcov(lcovPath) {
  if (!fs.existsSync(lcovPath)) {
    return { totals: zeroTotals(), records: [] };
  }

  const lines = fs.readFileSync(lcovPath, "utf8").split(/\r?\n/);
  const records = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("SF:")) {
      if (current) records.push(current);
      current = {
        file: toRepoRelative(line.slice(3)),
        LH: 0,
        LF: 0,
        BRH: 0,
        BRF: 0,
        FNH: 0,
        FNF: 0,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("LH:")) current.LH = Number(line.slice(3));
    if (line.startsWith("LF:")) current.LF = Number(line.slice(3));
    if (line.startsWith("BRH:")) current.BRH = Number(line.slice(4));
    if (line.startsWith("BRF:")) current.BRF = Number(line.slice(4));
    if (line.startsWith("FNH:")) current.FNH = Number(line.slice(4));
    if (line.startsWith("FNF:")) current.FNF = Number(line.slice(4));
    if (line === "end_of_record") {
      records.push(current);
      current = null;
    }
  }
  if (current) records.push(current);

  const mergedRecords = mergeRecordsByFile(records);
  return {
    totals: metricFromRecords(mergedRecords),
    records: mergedRecords,
  };
}

function selectRecordsByFiles(records, files) {
  const fileSet = new Set(files);
  return records.filter((record) => fileSet.has(record.file));
}

function mergeRecordsByFile(records) {
  const byFile = new Map();
  for (const record of records) {
    const existing = byFile.get(record.file);
    if (!existing) {
      byFile.set(record.file, { ...record });
      continue;
    }
    existing.LH = Math.max(existing.LH || 0, record.LH || 0);
    existing.LF = Math.max(existing.LF || 0, record.LF || 0);
    existing.BRH = Math.max(existing.BRH || 0, record.BRH || 0);
    existing.BRF = Math.max(existing.BRF || 0, record.BRF || 0);
    existing.FNH = Math.max(existing.FNH || 0, record.FNH || 0);
    existing.FNF = Math.max(existing.FNF || 0, record.FNF || 0);
  }
  return Array.from(byFile.values());
}

function zeroTotals() {
  return {
    lines_hit: 0,
    lines_found: 0,
    lines_pct: 0,
    branches_hit: 0,
    branches_found: 0,
    branches_pct: 0,
    functions_hit: 0,
    functions_found: 0,
    functions_pct: 0,
  };
}

function pct(hit, found) {
  if (!found) return 100;
  return Number(((hit / found) * 100).toFixed(2));
}

function metricFromRecords(records) {
  const linesHit = records.reduce((sum, row) => sum + (row.LH || 0), 0);
  const linesFound = records.reduce((sum, row) => sum + (row.LF || 0), 0);
  const branchesHit = records.reduce((sum, row) => sum + (row.BRH || 0), 0);
  const branchesFound = records.reduce((sum, row) => sum + (row.BRF || 0), 0);
  const functionsHit = records.reduce((sum, row) => sum + (row.FNH || 0), 0);
  const functionsFound = records.reduce((sum, row) => sum + (row.FNF || 0), 0);

  return {
    lines_hit: linesHit,
    lines_found: linesFound,
    lines_pct: pct(linesHit, linesFound),
    branches_hit: branchesHit,
    branches_found: branchesFound,
    branches_pct: pct(branchesHit, branchesFound),
    functions_hit: functionsHit,
    functions_found: functionsFound,
    functions_pct: pct(functionsHit, functionsFound),
  };
}

function walkFiles(relativeDir) {
  const absDir = path.join(REPO_ROOT, relativeDir);
  if (!fs.existsSync(absDir)) return [];

  const stack = [absDir];
  const results = [];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        results.push(normalizePath(path.relative(REPO_ROOT, absolute)));
      }
    }
  }
  return results;
}

function readFileSafe(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch (_error) {
    return null;
  }
}

function isThinSupabaseEntrypointWrapper(filePath) {
  if (!/^supabase\/functions\/[^/]+\/index\.ts$/.test(filePath)) {
    return false;
  }
  const content = readFileSafe(filePath);
  if (!content) return false;

  const normalized = content.replace(/\s+/g, " ").trim();
  return /^import\s*\{\s*handleRequest\s*\}\s*from\s*["']\.\/handler\.ts["'];\s*Deno\.serve\(\s*handleRequest\s*\);\s*$/.test(
    normalized,
  );
}

function isProdTs(filePath) {
  return (
    /\.(ts|tsx)$/.test(filePath) &&
    !/\.d\.ts$/.test(filePath) &&
    !/\.(test|spec)\.(ts|tsx)$/.test(filePath)
  );
}

function collectSurfaceFiles() {
  const web = walkFiles("src").filter(isProdTs);
  const extension = [...walkFiles("browserExtension/src"), ...walkFiles("browserExtension/popup-src")].filter(isProdTs);
  const scripts = walkFiles("scripts").filter(isProdTs);
  const supabaseFunctionCandidates = walkFiles("supabase/functions")
    .filter((filePath) => /\.ts$/.test(filePath))
    .filter((filePath) => !/_test\.ts$/.test(filePath))
    .filter((filePath) => !/\.d\.ts$/.test(filePath))
    .filter((filePath) => filePath !== "supabase/functions/_shared/database.types.ts")
    .filter((filePath) => filePath !== "supabase/functions/_shared/deno.d.ts")
    .filter((filePath) => filePath !== "supabase/functions/_shared/url-modules.d.ts");

  const supabaseEntrypointWrappers = supabaseFunctionCandidates.filter(isThinSupabaseEntrypointWrapper);
  const supabaseFunctions = supabaseFunctionCandidates.filter((filePath) => !supabaseEntrypointWrappers.includes(filePath));

  return {
    web,
    extension,
    scripts,
    supabase_functions: supabaseFunctions,
    supabase_function_entrypoint_wrappers: supabaseEntrypointWrappers,
  };
}

function toFileCoverage(record) {
  return {
    file: record.file,
    lines_hit: record.LH || 0,
    lines_found: record.LF || 0,
    lines_pct: pct(record.LH || 0, record.LF || 0),
    branches_hit: record.BRH || 0,
    branches_found: record.BRF || 0,
    branches_pct: pct(record.BRH || 0, record.BRF || 0),
  };
}

function surfaceCoverage({ files, coveredSet, records }) {
  const instrumented = files.filter((filePath) => coveredSet.has(filePath));
  const uninstrumented = files.filter((filePath) => !coveredSet.has(filePath));
  const fileSet = new Set(files);
  const recordSubset = records.filter((record) => fileSet.has(record.file));
  const lowCoverageFiles = recordSubset
    .filter((record) => (record.LF || 0) > 0)
    .filter((record) => (record.LH || 0) < (record.LF || 0))
    .map(toFileCoverage)
    .sort((a, b) => {
      if (a.lines_pct === b.lines_pct) {
        return b.lines_found - a.lines_found;
      }
      return a.lines_pct - b.lines_pct;
    });
  const zeroHitFiles = lowCoverageFiles.filter((row) => row.lines_hit === 0).map((row) => row.file);

  return {
    total_files: files.length,
    instrumented_files: instrumented.length,
    instrumented_ratio_pct: pct(instrumented.length, files.length),
    uninstrumented_files: uninstrumented,
    zero_hit_files: zeroHitFiles,
    zero_hit_file_count: zeroHitFiles.length,
    low_coverage_files: lowCoverageFiles.slice(0, 20),
    metrics: metricFromRecords(recordSubset),
  };
}

function writeTextReport(summary) {
  const lines = [];
  lines.push("# Coverage Report");
  lines.push("");
  lines.push(`Generated: ${summary.generated_at}`);
  lines.push("");
  lines.push("## Runtime Metrics");
  lines.push("");
  lines.push(`- Vitest lines: ${summary.vitest.lines_pct}% (${summary.vitest.lines_hit}/${summary.vitest.lines_found})`);
  lines.push(`- Vitest branches: ${summary.vitest.branches_pct}% (${summary.vitest.branches_hit}/${summary.vitest.branches_found})`);
  lines.push(`- Deno lines: ${summary.deno.lines_pct}% (${summary.deno.lines_hit}/${summary.deno.lines_found})`);
  lines.push(`- Deno branches: ${summary.deno.branches_pct}% (${summary.deno.branches_hit}/${summary.deno.branches_found})`);
  lines.push("");
  lines.push("## Surface Instrumentation");
  lines.push("");
  for (const [name, surface] of Object.entries(summary.surfaces)) {
    lines.push(
      `- ${name}: ${surface.instrumented_files}/${surface.total_files} instrumented (${surface.instrumented_ratio_pct}%), line ${surface.metrics.lines_pct}%, branch ${surface.metrics.branches_pct}%, zero-hit files ${surface.zero_hit_file_count}`,
    );
  }
  lines.push("");
  if (summary.meta.supabase_function_entrypoint_wrappers.length > 0) {
    lines.push("## Supabase Entrypoint Wrappers (Excluded)");
    lines.push("");
    lines.push(
      "- These files only register `Deno.serve(handleRequest)` and are excluded from function instrumentation coverage.",
    );
    for (const filePath of summary.meta.supabase_function_entrypoint_wrappers) {
      lines.push(`- ${filePath}`);
    }
    lines.push("");
  }
  lines.push("## DB Mapping");
  lines.push("");
  lines.push(
    `- DB functions mapped: ${summary.db.totals.mapped_db_functions}/${summary.db.totals.db_functions} (${summary.db.totals.function_mapping_ratio_pct}%)`,
  );
  lines.push(
    `- DB policies mapped: ${summary.db.totals.mapped_db_policies}/${summary.db.totals.db_policies} (${summary.db.totals.policy_mapping_ratio_pct}%)`,
  );
  lines.push("");
  if (summary.db.changed.db_objects.length > 0) {
    lines.push("## Changed DB Objects");
    lines.push("");
    for (const item of summary.db.changed.db_objects) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  lines.push("## Lowest Covered Files");
  lines.push("");
  for (const [name, surface] of Object.entries(summary.surfaces)) {
    lines.push(`### ${name}`);
    lines.push("");
    if (surface.low_coverage_files.length === 0) {
      lines.push("- none");
      lines.push("");
      continue;
    }
    for (const fileInfo of surface.low_coverage_files.slice(0, 10)) {
      lines.push(
        `- ${fileInfo.file}: line ${fileInfo.lines_pct}% (${fileInfo.lines_hit}/${fileInfo.lines_found}), branch ${fileInfo.branches_pct}% (${fileInfo.branches_hit}/${fileInfo.branches_found})`,
      );
    }
    lines.push("");
  }

  lines.push("## Uninstrumented Files");
  lines.push("");
  for (const [name, surface] of Object.entries(summary.surfaces)) {
    lines.push(`### ${name}`);
    lines.push("");
    if (surface.uninstrumented_files.length === 0) {
      lines.push("- none");
    } else {
      for (const item of surface.uninstrumented_files) {
        lines.push(`- ${item}`);
      }
    }
    lines.push("");
  }
  lines.push("## Unmapped DB Objects");
  lines.push("");
  if (summary.db.unmapped.functions.length === 0 && summary.db.unmapped.policies.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.db.unmapped.functions) {
      lines.push(`- ${item}`);
    }
    for (const item of summary.db.unmapped.policies) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const vitestCoverage = parseLcov(path.join(REPO_ROOT, "coverage", "lcov.info"));
  const denoCoverage = parseLcov(path.join(REPO_ROOT, ".coverage", "deno", "lcov.info"));
  const dbCoverage = collectDbCoverage();

  const surfaces = collectSurfaceFiles();
  const targetSurfaces = {
    web: surfaces.web,
    extension: surfaces.extension,
    scripts: surfaces.scripts,
    supabase_functions: surfaces.supabase_functions,
  };
  const vitestTargetFiles = [...targetSurfaces.web, ...targetSurfaces.extension, ...targetSurfaces.scripts];
  const denoTargetFiles = targetSurfaces.supabase_functions;

  const vitestSet = new Set(vitestCoverage.records.map((record) => record.file));
  const denoSet = new Set(denoCoverage.records.map((record) => record.file));
  const vitestTargetRecords = selectRecordsByFiles(vitestCoverage.records, vitestTargetFiles);
  const denoTargetRecords = selectRecordsByFiles(denoCoverage.records, denoTargetFiles);

  const summary = {
    generated_at: new Date().toISOString(),
    vitest: metricFromRecords(vitestTargetRecords),
    deno: metricFromRecords(denoTargetRecords),
    surfaces: {
      web: surfaceCoverage({
        files: targetSurfaces.web,
        coveredSet: vitestSet,
        records: vitestCoverage.records,
      }),
      extension: surfaceCoverage({
        files: targetSurfaces.extension,
        coveredSet: vitestSet,
        records: vitestCoverage.records,
      }),
      scripts: surfaceCoverage({
        files: targetSurfaces.scripts,
        coveredSet: vitestSet,
        records: vitestCoverage.records,
      }),
      supabase_functions: surfaceCoverage({
        files: targetSurfaces.supabase_functions,
        coveredSet: denoSet,
        records: denoCoverage.records,
      }),
    },
    meta: {
      supabase_function_entrypoint_wrappers: surfaces.supabase_function_entrypoint_wrappers,
      target_vitest_files: vitestTargetFiles.length,
      target_deno_files: denoTargetFiles.length,
    },
    db: dbCoverage,
  };

  const coverageDir = path.join(REPO_ROOT, "coverage");
  fs.mkdirSync(coverageDir, { recursive: true });
  const jsonPath = path.join(coverageDir, "combined-summary.json");
  const mdPath = path.join(coverageDir, "combined-report.md");

  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(mdPath, writeTextReport(summary));

  console.log(`[coverage-report] summary: ${normalizePath(path.relative(REPO_ROOT, jsonPath))}`);
  console.log(`[coverage-report] report: ${normalizePath(path.relative(REPO_ROOT, mdPath))}`);
}

main();
