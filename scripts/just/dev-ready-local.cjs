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

function resolveNpxBin() {
  const nodeDir = path.dirname(process.execPath);
  if (process.platform === "win32") {
    const npxCmd = path.join(nodeDir, "npx.cmd");
    if (fs.existsSync(npxCmd)) {
      return npxCmd;
    }
    return "npx.cmd";
  }

  const npxBin = path.join(nodeDir, "npx");
  if (fs.existsSync(npxBin)) {
    return npxBin;
  }
  return "npx";
}

function logInfo(message) {
  console.log(`[dev-ready-local] ${message}`);
}

const JUST_BIN = resolveJustBin();
const NPX_BIN = resolveNpxBin();
const CONCURRENTLY_PACKAGE_JSON = require.resolve("concurrently/package.json");
const CONCURRENTLY_BIN = path.join(
  path.dirname(CONCURRENTLY_PACKAGE_JSON),
  "dist",
  "bin",
  "concurrently.js",
);
const stopDbOnExit = (process.argv[2] || "true").toLowerCase() !== "false";
let cleanedUp = false;

function runNpxSync(args, options = {}) {
  const baseOptions = {
    env: process.env,
    ...options,
  };

  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return spawnSync(comspec, ["/d", "/s", "/c", NPX_BIN, ...args], baseOptions);
  }

  return spawnSync(NPX_BIN, args, baseOptions);
}

function formatArgsForLogs(args) {
  const maskedArgs = [...args];
  const passwordIndex = maskedArgs.indexOf("--password");
  if (passwordIndex >= 0 && passwordIndex + 1 < maskedArgs.length) {
    maskedArgs[passwordIndex + 1] = "***";
  }
  return maskedArgs.join(" ");
}

function runStep(recipe) {
  logInfo(`Running recipe: ${recipe}`);
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

function runStepCapture(recipe) {
  logInfo(`Running recipe (captured): ${recipe}`);
  const result = spawnSync(JUST_BIN, [recipe], {
    stdio: "pipe",
    env: process.env,
    encoding: "utf8",
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  const status = typeof result.status === "number" ? result.status : 1;
  return { status, stdout, stderr, error: result.error };
}

function linkedProjectVersionDrift(output) {
  return /WARNING:\s+You are running different service versions locally than your linked project:/i.test(
    output,
  );
}

function readLinkedProjectRef() {
  const projectRefPath = path.join(process.cwd(), "supabase", ".temp", "project-ref");
  if (!fs.existsSync(projectRefPath)) {
    return null;
  }

  const projectRef = fs.readFileSync(projectRefPath, "utf8").trim();
  return projectRef || null;
}

function updateLinkedProjectServices() {
  const projectRef = readLinkedProjectRef();
  if (!projectRef) {
    console.error(
      "Local Supabase service versions differ, but linked project ref was not found at supabase/.temp/project-ref. Run `npx supabase link --project-ref <project-ref>` and retry.",
    );
    return 1;
  }

  const args = ["supabase", "link", "--project-ref", projectRef, "--yes"];
  if (process.env.SUPABASE_DB_PASSWORD) {
    args.push("--password", process.env.SUPABASE_DB_PASSWORD);
  }

  logInfo(`Detected Supabase version drift. Relinking local config to project '${projectRef}' to sync service versions.`);
  logInfo(`Running command: npx ${formatArgsForLogs(args)}`);
  const result = runNpxSync(args, { stdio: "inherit" });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error(result.error.message);
  }
  return 1;
}

function startSupabaseWithVersionSync() {
  logInfo("Starting local Supabase services.");
  const firstStart = runStepCapture("supabase-local-start");
  if (firstStart.error) {
    console.error(firstStart.error.message);
    return 1;
  }

  const combinedOutput = `${firstStart.stdout}\n${firstStart.stderr}`;
  const driftDetected = linkedProjectVersionDrift(combinedOutput);
  if (!driftDetected) {
    logInfo("Supabase start completed without linked-project service version drift.");
    return firstStart.status;
  }

  logInfo("Version drift detected after initial start. Stopping local stack before syncing versions.");
  const stopCode = runStep("supabase-local-stop");
  if (stopCode !== 0) {
    return stopCode;
  }

  const updateCode = updateLinkedProjectServices();
  if (updateCode !== 0) {
    return updateCode;
  }

  logInfo("Retrying Supabase start after service version sync.");
  const secondStart = runStepCapture("supabase-local-start");
  if (secondStart.error) {
    console.error(secondStart.error.message);
    return 1;
  }

  const secondOutput = `${secondStart.stdout}\n${secondStart.stderr}`;
  if (linkedProjectVersionDrift(secondOutput)) {
    logInfo("Service version drift warning still present after relink/start retry.");
    return 1;
  }

  if (secondStart.status === 0) {
    logInfo("Supabase start succeeded after relink.");
  }
  return secondStart.status;
}

function stopSupabaseIfNeeded() {
  if (!stopDbOnExit || cleanedUp) {
    return 0;
  }
  cleanedUp = true;
  logInfo("Stopping local Supabase services for cleanup.");
  return runStep("supabase-local-stop");
}

logInfo(`Using just binary: ${JUST_BIN}`);
logInfo(`Using npx binary: ${NPX_BIN}`);

const dockerReadyCode = ensureDockerReady();
if (dockerReadyCode !== 0) {
  process.exit(dockerReadyCode);
}

const startCode = startSupabaseWithVersionSync();
if (startCode !== 0) {
  logInfo(`Supabase start/setup failed with exit code ${startCode}.`);
  stopSupabaseIfNeeded();
  process.exit(startCode);
}

logInfo("Applying local migrations and deploy SQL.");
const migrateCode = runStep("supabase-local-migrate-and-deploy");
if (migrateCode !== 0) {
  logInfo(`Migration/deploy step failed with exit code ${migrateCode}.`);
  stopSupabaseIfNeeded();
  process.exit(migrateCode);
}

logInfo("Launching web, extension, and edge-function dev processes.");
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
