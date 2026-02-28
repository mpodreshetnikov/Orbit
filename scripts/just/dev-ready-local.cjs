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
const authMode = (process.argv[3] || "default").toLowerCase();
const obsAutoEnabled = (process.env.OBS_AUTO || "1").toLowerCase() !== "0";
const syncSupabaseOnVersionDrift =
  (process.env.SUPABASE_SYNC_ON_DRIFT || "0").toLowerCase() === "1";
const requiredWebPort = Number.parseInt(process.env.WEB_DEV_PORT || "3000", 10);
let cleanedUp = false;
let obsStarted = false;

function parseSupabaseStatusEnv(output) {
  const parsed = {};
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    if (!key) {
      continue;
    }

    let value = valueParts.join("=");
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

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

function readSupabaseRuntimeEnv() {
  const result = runNpxSync(["supabase", "status", "-o", "env"], {
    stdio: "pipe",
    encoding: "utf8",
  });

  if (typeof result.status !== "number" || result.status !== 0) {
    return null;
  }

  return parseSupabaseStatusEnv(result.stdout || "");
}

function configureDevAuthBypassEnv() {
  if (authMode !== "bypass") {
    return 0;
  }

  process.env.DEV_AUTH_BYPASS_ENABLED = "1";
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED = "1";

  const runtimeEnv = readSupabaseRuntimeEnv();
  if (runtimeEnv) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && runtimeEnv.SERVICE_ROLE_KEY) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = runtimeEnv.SERVICE_ROLE_KEY;
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL && runtimeEnv.API_URL) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = runtimeEnv.API_URL;
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && runtimeEnv.ANON_KEY) {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = runtimeEnv.ANON_KEY;
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[dev-ready-local] Missing SUPABASE_SERVICE_ROLE_KEY for bypass mode. Set it in env and retry.",
    );
    return 1;
  }

  logInfo("Dev auth bypass enabled for this session.");
  return 0;
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

function hasInconsistentLocalStack(output) {
  return (
    /supabase start is already running\./i.test(output) &&
    /(container is not running: exited|No such container)/i.test(output)
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

  logInfo(
    `Detected Supabase version drift. Relinking local config to project '${projectRef}' to sync service versions.`,
  );
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
  if (firstStart.status !== 0) {
    if (hasInconsistentLocalStack(combinedOutput)) {
      logInfo("Detected inconsistent local Supabase stack. Stopping and retrying startup once.");
      const stopCode = runStep("supabase-local-stop");
      if (stopCode !== 0) {
        return stopCode;
      }

      const retryStart = runStepCapture("supabase-local-start");
      if (retryStart.error) {
        console.error(retryStart.error.message);
        return 1;
      }

      if (retryStart.status !== 0) {
        return retryStart.status;
      }
      logInfo("Supabase start succeeded after local stack recovery.");
      return 0;
    }

    return firstStart.status;
  }

  const driftDetected = linkedProjectVersionDrift(combinedOutput);
  if (!driftDetected) {
    logInfo("Supabase start completed without linked-project service version drift.");
    return firstStart.status;
  }

  if (!syncSupabaseOnVersionDrift) {
    logInfo(
      "Supabase linked-project version drift detected. Continuing startup (set SUPABASE_SYNC_ON_DRIFT=1 to auto-relink and retry).",
    );
    return firstStart.status;
  }

  logInfo(
    "Version drift detected after initial start. Stopping local stack before syncing versions.",
  );
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
    logInfo(
      "Service version drift warning still present after relink/start retry. Continuing with local startup.",
    );
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

function stopObservabilityIfNeeded() {
  if (!obsAutoEnabled || !obsStarted) {
    return 0;
  }
  logInfo("Stopping local observability services for cleanup.");
  obsStarted = false;
  return runStep("obs-down");
}

function getListeningPidsForPort(port) {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.error || typeof result.stdout !== "string") {
    return [];
  }

  const pids = new Set();
  const portSuffix = `:${port}`;
  const lines = result.stdout.split(/\r?\n/);
  for (const line of lines) {
    if (!/\bLISTENING\b/i.test(line)) {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) {
      continue;
    }

    const localAddress = parts[1] || "";
    const pid = Number.parseInt(parts[4], 10);
    if (!localAddress.endsWith(portSuffix) || Number.isNaN(pid)) {
      continue;
    }
    pids.add(pid);
  }

  return [...pids];
}

function getWindowsProcessCommandLine(pid) {
  if (process.platform !== "win32") {
    return "";
  }

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }`,
    ],
    {
      stdio: "pipe",
      encoding: "utf8",
    },
  );
  if (result.error || typeof result.stdout !== "string") {
    return "";
  }
  return result.stdout.trim();
}

function terminateProcessTree(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return typeof result.status === "number" ? result.status : 1;
  }

  const result = spawnSync("kill", ["-9", String(pid)], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return typeof result.status === "number" ? result.status : 1;
}

function ensureRequiredWebPortAvailable(port) {
  if (!Number.isInteger(port) || port <= 0) {
    return 0;
  }

  const listeningPids = getListeningPidsForPort(port);
  if (listeningPids.length === 0) {
    return 0;
  }

  const cwdLower = process.cwd().toLowerCase().replace(/\//g, "\\");
  for (const pid of listeningPids) {
    const commandLine = getWindowsProcessCommandLine(pid).toLowerCase();
    const isStaleNextProcess =
      commandLine.includes(cwdLower) &&
      commandLine.includes("next") &&
      (commandLine.includes("start-server.js") || commandLine.includes("next\\dist\\bin\\next"));

    if (isStaleNextProcess) {
      logInfo(
        `Port ${port} is occupied by stale Next.js process ${pid}. Terminating process tree.`,
      );
      terminateProcessTree(pid);
    }
  }

  const remainingPids = getListeningPidsForPort(port);
  if (remainingPids.length === 0) {
    return 0;
  }

  const ownerPid = remainingPids[0];
  const ownerCommand = getWindowsProcessCommandLine(ownerPid);
  console.error(
    `Required web port ${port} is already in use by PID ${ownerPid}. ${ownerCommand ? `Command: ${ownerCommand}` : ""}`.trim(),
  );
  console.error("Free port 3000 (or set WEB_DEV_PORT) and retry.");
  return 1;
}

logInfo(`Using just binary: ${JUST_BIN}`);
logInfo(`Using npx binary: ${NPX_BIN}`);
logInfo(`Auth mode: ${authMode}`);

if (authMode !== "default" && authMode !== "bypass") {
  console.error(`[dev-ready-local] Unknown auth mode '${authMode}'. Use 'default' or 'bypass'.`);
  process.exit(1);
}

const dockerReadyCode = ensureDockerReady();
if (dockerReadyCode !== 0) {
  process.exit(dockerReadyCode);
}

if (obsAutoEnabled) {
  logInfo("Starting local observability services.");
  const obsUpCode = runStep("obs-up");
  if (obsUpCode !== 0) {
    logInfo(`Observability start failed with exit code ${obsUpCode}.`);
    process.exit(obsUpCode);
  }
  obsStarted = true;
}

const startCode = startSupabaseWithVersionSync();
if (startCode !== 0) {
  logInfo(`Supabase start/setup failed with exit code ${startCode}.`);
  stopSupabaseIfNeeded();
  stopObservabilityIfNeeded();
  process.exit(startCode);
}

logInfo("Applying local migrations and deploy SQL.");
const migrateCode = runStep("supabase-local-migrate-and-deploy");
if (migrateCode !== 0) {
  logInfo(`Migration/deploy step failed with exit code ${migrateCode}.`);
  stopSupabaseIfNeeded();
  stopObservabilityIfNeeded();
  process.exit(migrateCode);
}

const bypassEnvCode = configureDevAuthBypassEnv();
if (bypassEnvCode !== 0) {
  stopSupabaseIfNeeded();
  stopObservabilityIfNeeded();
  process.exit(bypassEnvCode);
}

const webPortCheckCode = ensureRequiredWebPortAvailable(requiredWebPort);
if (webPortCheckCode !== 0) {
  stopSupabaseIfNeeded();
  stopObservabilityIfNeeded();
  process.exit(webPortCheckCode);
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
  const obsCleanupCode = stopObservabilityIfNeeded();
  let exitCode = typeof code === "number" ? code : 1;
  if (exitCode === 0 && cleanupCode !== 0) {
    exitCode = cleanupCode;
  }
  if (exitCode === 0 && obsCleanupCode !== 0) {
    exitCode = obsCleanupCode;
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
  stopObservabilityIfNeeded();
});

child.on("exit", (code) => {
  finalize(code);
});

child.on("error", (error) => {
  console.error(error.message);
  finalize(1);
});
