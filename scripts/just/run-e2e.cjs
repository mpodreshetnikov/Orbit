#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REQUIRED_PARSER_MODE = "e2e_stub";
const NPX_BIN = resolveNpxBin();

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

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
    ...options,
  });
}

function runInherited(command, args) {
  return spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
}

function runNpx(args, options = {}) {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return run(comspec, ["/d", "/s", "/c", NPX_BIN, ...args], options);
  }

  return run(NPX_BIN, args, options);
}

function runNpxInherited(args) {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return runInherited(comspec, ["/d", "/s", "/c", NPX_BIN, ...args]);
  }

  return runInherited(NPX_BIN, args);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readSupabaseProjectId() {
  const configPath = path.join(process.cwd(), "supabase", "config.toml");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const config = fs.readFileSync(configPath, "utf8");
  const match = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

function readEdgeRuntimeParserMode(projectId) {
  if (!projectId) {
    return null;
  }

  const containerName = `supabase_edge_runtime_${projectId}`;
  const inspect = run("docker", ["inspect", containerName, "--format", "{{json .Config.Env}}"]);
  if (inspect.status !== 0) {
    return null;
  }

  const envEntries = parseJson((inspect.stdout || "").trim(), []);
  if (!Array.isArray(envEntries)) {
    return null;
  }

  const parserEntry = envEntries.find(
    (entry) => typeof entry === "string" && entry.startsWith("HEALTH_STRUCTURE_PARSER_MODE="),
  );
  if (!parserEntry || typeof parserEntry !== "string") {
    return null;
  }
  return parserEntry.slice("HEALTH_STRUCTURE_PARSER_MODE=".length) || null;
}

function parseSupabaseEnv(output) {
  const vars = {};
  const lines = String(output || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([A-Z0-9_]+)="(.*)"$/);
    if (!match) continue;
    vars[match[1]] = match[2];
  }
  return vars;
}

function applyE2EDefaultEnv() {
  if (!process.env.HEALTH_STRUCTURE_PARSER_MODE) {
    process.env.HEALTH_STRUCTURE_PARSER_MODE = REQUIRED_PARSER_MODE;
  }
  if (process.env.HEALTH_STRUCTURE_PARSER_MODE !== REQUIRED_PARSER_MODE) {
    throw new Error(
      `HEALTH_STRUCTURE_PARSER_MODE must be '${REQUIRED_PARSER_MODE}' for e2e extraction tests.`,
    );
  }

  if (!process.env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = "e2e-local-disabled";
  }
  if (!process.env.DEV_AUTH_BYPASS_ENABLED) {
    process.env.DEV_AUTH_BYPASS_ENABLED = "1";
  }
  if (!process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED) {
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED = "1";
  }
  if (!process.env.E2E_BASE_URL) {
    process.env.E2E_BASE_URL = "http://localhost:3100";
  }
}

function assertRunningStackParserMode() {
  const projectId = readSupabaseProjectId();
  const runningMode = readEdgeRuntimeParserMode(projectId);
  if (runningMode === REQUIRED_PARSER_MODE) {
    return;
  }

  throw new Error(
    [
      `Supabase is running without HEALTH_STRUCTURE_PARSER_MODE=${REQUIRED_PARSER_MODE}.`,
      "Ensure local Supabase starts in deterministic no-external-LLM mode.",
    ].join(" "),
  );
}

function startSupabase() {
  const start = runNpxInherited(["supabase", "start"]);
  if (start.status !== 0) {
    throw new Error("Failed to start local Supabase stack for e2e tests");
  }
}

function restartSupabase() {
  const stop = runNpxInherited(["supabase", "stop"]);
  if (stop.status !== 0) {
    throw new Error("Failed to stop local Supabase stack before e2e restart");
  }

  startSupabase();
}

function loadSupabaseEnv() {
  const status = runNpx(["supabase", "status", "-o", "env"]);
  if (status.status === 0) {
    const projectId = readSupabaseProjectId();
    const runningMode = readEdgeRuntimeParserMode(projectId);
    if (runningMode !== REQUIRED_PARSER_MODE) {
      console.log(
        `[test-e2e] Restarting Supabase in ${REQUIRED_PARSER_MODE} mode (current: ${runningMode ?? "unset"}).`,
      );
      restartSupabase();
      const restartedStatus = runNpx(["supabase", "status", "-o", "env"]);
      if (restartedStatus.status !== 0) {
        throw new Error("Supabase restarted but status lookup failed");
      }
      assertRunningStackParserMode();
      return {
        shouldStop: false,
        vars: parseSupabaseEnv(restartedStatus.stdout),
      };
    }

    return {
      shouldStop: false,
      vars: parseSupabaseEnv(status.stdout),
    };
  }

  startSupabase();

  const statusAfterStart = runNpx(["supabase", "status", "-o", "env"]);
  if (statusAfterStart.status !== 0) {
    throw new Error("Supabase started but status lookup failed");
  }
  assertRunningStackParserMode();

  return {
    shouldStop: true,
    vars: parseSupabaseEnv(statusAfterStart.stdout),
  };
}

function applyE2EEnv(vars) {
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.API_URL) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.API_URL;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.ANON_KEY) {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.ANON_KEY;
  }
}

function ensureLocalDbReady() {
  const migrate = runNpxInherited(["supabase", "migration", "up"]);
  if (migrate.status !== 0) {
    throw new Error("Failed to apply local Supabase migrations for e2e tests");
  }

  const deploySql = runInherited(process.execPath, ["supabase/db/run-deploy.js", "local"]);
  if (deploySql.status !== 0) {
    throw new Error("Failed to apply local deploy SQL for e2e tests");
  }
}

function runPlaywright() {
  const extraArgs = process.argv.slice(2);
  const result = runNpxInherited([
    "playwright",
    "test",
    "--config=e2e/playwright.config.ts",
    ...extraArgs,
  ]);
  return typeof result.status === "number" ? result.status : 1;
}

function stopSupabaseIfNeeded(shouldStop) {
  if (!shouldStop) return 0;
  const stop = runNpxInherited(["supabase", "stop"]);
  return typeof stop.status === "number" ? stop.status : 1;
}

function main() {
  let shouldStop = false;
  let exitCode = 1;

  try {
    applyE2EDefaultEnv();
    const { vars, shouldStop: shouldStopLocalStack } = loadSupabaseEnv();
    shouldStop = shouldStopLocalStack;
    applyE2EEnv(vars);
    ensureLocalDbReady();
    exitCode = runPlaywright();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    exitCode = 1;
  } finally {
    const stopCode = stopSupabaseIfNeeded(shouldStop);
    if (exitCode === 0 && stopCode !== 0) {
      exitCode = stopCode;
    }
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}
