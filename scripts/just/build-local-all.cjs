#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ensureDockerReady } = require("./docker-preflight.cjs");
const { detectChangeImpact } = require("./change-impact.cjs");

function resolveJustBin() {
  if (process.env.JUST_BIN) {
    return process.env.JUST_BIN;
  }

  if (process.platform === "win32") {
    const wingetJust = path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft",
      "WinGet",
      "Links",
      "just.exe",
    );
    if (wingetJust && fs.existsSync(wingetJust)) {
      return wingetJust;
    }
  }

  return "just";
}

function runStep(justBin, recipe) {
  const result = spawnSync(justBin, [recipe], {
    stdio: "inherit",
    env: process.env,
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error(result.error.message);
  }
  return 1;
}

function parseDbMode(argv) {
  const args = argv.slice(2);
  let dbMode = "auto";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--db-mode") {
      dbMode = args[index + 1] ?? dbMode;
      index += 1;
      continue;
    }
    if (arg.startsWith("--db-mode=")) {
      dbMode = arg.slice("--db-mode=".length);
      continue;
    }
  }

  const normalized = String(dbMode).toLowerCase();
  if (!["auto", "always", "skip"].includes(normalized)) {
    throw new Error(`Invalid --db-mode value: ${dbMode}. Use auto, always, or skip.`);
  }

  return normalized;
}

function resolveDbExecutionPlan({ dbMode, impact }) {
  if (dbMode === "always") {
    return {
      runDbChecks: true,
      reason: "db-mode=always",
    };
  }

  if (dbMode === "skip") {
    return {
      runDbChecks: false,
      reason: "db-mode=skip",
    };
  }

  if (!impact) {
    return {
      runDbChecks: true,
      reason: "db-mode=auto with unknown change impact (safe fallback)",
    };
  }

  if (!Array.isArray(impact.changedFiles) || impact.changedFiles.length === 0) {
    return {
      runDbChecks: true,
      reason: "db-mode=auto with empty change set (safe fallback)",
    };
  }

  return {
    runDbChecks: Boolean(impact.dbImpact),
    reason: `db-mode=auto with dbImpact=${Boolean(impact.dbImpact)}`,
  };
}

function buildRecipes({ reuseSupabase, runDbChecks }) {
  return [
    "web-build-production",
    "extension-build-production",
    ...(runDbChecks
      ? [
          ...(reuseSupabase ? [] : ["supabase-local-start"]),
          "supabase-local-reset-and-deploy",
          "quality-db-lint",
          "quality-db-test",
        ]
      : []),
  ];
}

function runBuildLocalAll({ dbMode = "auto" } = {}) {
  const justBin = resolveJustBin();
  const reuseSupabase = process.env.SUPABASE_ALREADY_RUNNING === "1";
  const impact = dbMode === "auto" ? detectChangeImpact() : null;
  const executionPlan = resolveDbExecutionPlan({ dbMode, impact });
  const recipes = buildRecipes({
    reuseSupabase,
    runDbChecks: executionPlan.runDbChecks,
  });

  console.log(
    `[build-local-all] ${executionPlan.reason}; runDbChecks=${executionPlan.runDbChecks}`,
  );

  if (executionPlan.runDbChecks) {
    const dockerReadyCode = ensureDockerReady();
    if (dockerReadyCode !== 0) {
      return dockerReadyCode;
    }
  }

  let exitCode = 0;
  let cleanedUp = false;
  let startedSupabase = false;

  function cleanup() {
    if (cleanedUp) {
      return 0;
    }
    cleanedUp = true;

    if (!startedSupabase || reuseSupabase) {
      return 0;
    }

    return runStep(justBin, "supabase-local-stop");
  }

  function exitWithCleanup(code) {
    const cleanupCode = cleanup();
    if (code === 0 && cleanupCode !== 0) {
      process.exit(cleanupCode);
      return;
    }
    process.exit(code);
  }

  process.on("SIGINT", () => exitWithCleanup(130));
  process.on("SIGTERM", () => exitWithCleanup(143));

  try {
    for (const recipe of recipes) {
      const stepCode = runStep(justBin, recipe);
      if (stepCode !== 0) {
        exitCode = stepCode;
        break;
      }

      if (recipe === "supabase-local-start") {
        startedSupabase = true;
      }
    }
  } finally {
    const cleanupCode = cleanup();
    if (exitCode === 0 && cleanupCode !== 0) {
      exitCode = cleanupCode;
    }
  }

  return exitCode;
}

function main() {
  let dbMode;
  try {
    dbMode = parseDbMode(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const exitCode = runBuildLocalAll({ dbMode });
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildRecipes,
  parseDbMode,
  resolveDbExecutionPlan,
  runBuildLocalAll,
};
