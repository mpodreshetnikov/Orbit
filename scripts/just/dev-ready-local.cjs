#!/usr/bin/env node

const { spawn, spawnSync } = require("child_process");
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
const CONCURRENTLY_PACKAGE_JSON = require.resolve("concurrently/package.json");
const CONCURRENTLY_BIN = path.join(
  path.dirname(CONCURRENTLY_PACKAGE_JSON),
  "dist",
  "bin",
  "concurrently.js",
);
const stopDbOnExit = (process.argv[2] || "true").toLowerCase() !== "false";
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

function stopSupabaseIfNeeded() {
  if (!stopDbOnExit || cleanedUp) {
    return 0;
  }
  cleanedUp = true;
  return runStep("supabase-local-stop");
}

const setupRecipes = [
  "supabase-local-start",
  "supabase-local-migrate-and-deploy",
];

const dockerReadyCode = ensureDockerReady();
if (dockerReadyCode !== 0) {
  process.exit(dockerReadyCode);
}

for (const recipe of setupRecipes) {
  const stepCode = runStep(recipe);
  if (stepCode !== 0) {
    stopSupabaseIfNeeded();
    process.exit(stepCode);
  }
}

const concurrentlyArgs = [
  "--kill-others-on-fail",
  "--names",
  "web,extension,functions",
  `${JUST_BIN} web-dev-server`,
  `${JUST_BIN} extension-dev-watch`,
  `${JUST_BIN} supabase-local-functions-serve`,
];

const child = spawn(process.execPath, [CONCURRENTLY_BIN, ...concurrentlyArgs], {
  stdio: "inherit",
  env: process.env,
});

let shuttingDown = false;
let finalized = false;
let requestedSignal = null;
let shutdownTimer = null;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  requestedSignal = signal;

  if (!child.killed) {
    try {
      child.kill(signal);
    } catch {
      try {
        child.kill();
      } catch {
        // Ignore hard kill failures during shutdown.
      }
    }
  }

  shutdownTimer = setTimeout(() => {
    finalize(1);
  }, 10000);
}

function finalize(code) {
  if (finalized) {
    return;
  }
  finalized = true;
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }

  const cleanupCode = stopSupabaseIfNeeded();
  let exitCode = typeof code === "number" ? code : 1;
  if (exitCode === 0 && cleanupCode !== 0) {
    exitCode = cleanupCode;
  }

  if (requestedSignal) {
    process.exit(exitCode);
    return;
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => {
  console.error(error);
  finalize(1);
});
process.on("uncaughtException", (error) => {
  console.error(error);
  finalize(1);
});
process.on("exit", () => {
  stopSupabaseIfNeeded();
});

child.on("exit", (code) => {
  finalize(code);
});

child.on("error", (error) => {
  console.error(error.message);
  finalize(1);
});
