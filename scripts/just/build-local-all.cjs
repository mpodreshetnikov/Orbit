#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ensureDockerReady } = require("./docker-preflight.cjs");

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

const JUST_BIN = resolveJustBin();
let cleanedUp = false;

function runStep(recipe) {
  const result = spawnSync(JUST_BIN, [recipe], {
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

function cleanup() {
  if (cleanedUp) {
    return 0;
  }
  cleanedUp = true;
  return runStep("supabase-local-stop");
}

function exitWithCleanup(exitCode, signal) {
  const cleanupCode = cleanup();
  let finalCode = exitCode;
  if (finalCode === 0 && cleanupCode !== 0) {
    finalCode = cleanupCode;
  }

  if (signal) {
    process.exit(finalCode);
    return;
  }
  process.exit(finalCode);
}

process.on("SIGINT", () => exitWithCleanup(130, "SIGINT"));
process.on("SIGTERM", () => exitWithCleanup(143, "SIGTERM"));

let exitCode = 0;

try {
  const dockerReadyCode = ensureDockerReady();
  if (dockerReadyCode !== 0) {
    process.exit(dockerReadyCode);
  }

  const recipes = [
    "web-build-production",
    "extension-build-production",
    "supabase-local-start",
    "supabase-local-reset-and-deploy",
    "quality-db-lint",
    "quality-db-test",
  ];

  for (const recipe of recipes) {
    const stepCode = runStep(recipe);
    if (stepCode !== 0) {
      exitCode = stepCode;
      break;
    }
  }
} finally {
  const cleanupCode = cleanup();
  if (exitCode === 0 && cleanupCode !== 0) {
    exitCode = cleanupCode;
  }
}

process.exit(exitCode);
