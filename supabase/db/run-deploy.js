#!/usr/bin/env node
/**
 * Cross-platform DB deploy runner.
 * Sets GIT_SHA correctly on Windows (PowerShell/cmd) and Unix.
 *
 * Usage:
 *   node run-deploy.js [local] [--database-url <url>]
 *
 * Modes:
 *   local = use local Supabase URL
 *   remote = use --database-url or DATABASE_URL from env
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);
const isLocal = args.includes("local");
const dbDir = path.resolve(__dirname);

function getDatabaseUrlFromArgs(argv) {
  const directIndex = argv.indexOf("--database-url");
  if (directIndex !== -1) {
    return argv[directIndex + 1] || "";
  }
  const equalsArg = argv.find((arg) => arg.startsWith("--database-url="));
  if (equalsArg) {
    return equalsArg.slice("--database-url=".length);
  }
  return "";
}

let connectionString;
if (isLocal) {
  connectionString = "postgresql://postgres:postgres@localhost:54322/postgres";
} else {
  connectionString = getDatabaseUrlFromArgs(args) || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      'DATABASE_URL is not set. Use --database-url for remote deploy or "just supabase-local-deploy-sql" for local.',
    );
    process.exit(1);
  }
}

let gitSha;
try {
  gitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  gitSha = "";
}

// psql: ON_ERROR_STOP=1 makes deploy fail on first SQL error; GIT_SHA must be safe (no single quotes)
const psqlArgs = [
  connectionString,
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  `GIT_SHA=${gitSha}`,
  "-f",
  "deploy.sql",
];

/**
 * The deploy runs against a live database. Each phase drops and recreates every function and
 * trigger inside one transaction, and a request that holds a share lock on one of those tables
 * while waiting on something the deploy already holds is a deadlock. Postgres kills one side,
 * and it has been the deploy: run 339 on 2026-09-03 died in the triggers phase, on a file the
 * commit had not touched, and the extension publish that waits on this job was skipped with it.
 *
 * Every phase is transactional and every statement idempotent, so the script can simply be run
 * again; the request it collided with has finished by then. Anything other than a deadlock is
 * a real failure and stops on the first attempt.
 */
const DEADLOCK_ATTEMPTS = 3;
const DEADLOCK_RETRY_DELAY_MS = 5000;

function runDeploySql() {
  // stderr is captured to recognise the deadlock, then written through, so the log reads as
  // before.
  const result = spawnSync("psql", psqlArgs, { cwd: dbDir, stdio: ["ignore", "inherit", "pipe"] });
  const stderr = result.stderr ? result.stderr.toString() : "";
  if (stderr) process.stderr.write(stderr);
  if (result.error) console.error(result.error.message);
  return { status: result.status ?? 1, deadlocked: /deadlock detected/.test(stderr) };
}

for (let attempt = 1; attempt <= DEADLOCK_ATTEMPTS; attempt += 1) {
  const { status, deadlocked } = runDeploySql();
  if (status === 0) break;
  if (!deadlocked || attempt === DEADLOCK_ATTEMPTS) process.exit(status);
  console.error(
    `Deploy lost a deadlock (attempt ${attempt} of ${DEADLOCK_ATTEMPTS}); retrying in ${DEADLOCK_RETRY_DELAY_MS / 1000}s.`,
  );
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, DEADLOCK_RETRY_DELAY_MS);
}
