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
 *
 * Each phase of deploy.sql is applied as its own psql invocation rather than the whole file as
 * one. Two things need that. A phase that loses a lock to production traffic can be retried on
 * its own, which matters because losing is the expected outcome against a live database and not
 * an exceptional one. And when a phase does fail for good, the run can say which phases were
 * applied and which were not, instead of stopping on `ON_ERROR_STOP` with the rest of the deploy
 * silently skipped -- which is how production ran for a day without a version stamp while every
 * red run read as "the policies did not change anyway" (T-260902-60d).
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const dbDir = path.resolve(__dirname);
const DEPLOY_SQL = path.join(dbDir, "deploy.sql");

// Lock behaviour for every phase. lock_timeout sits below deadlock_timeout on purpose: the deploy
// gives a contended lock up itself, quickly and with a named error, rather than waiting long
// enough for the deadlock detector to choose a victim at an arbitrary point. deploy.sql sets the
// same two values for a manual single-shot run, and a test asserts the two stay identical.
const SESSION_SETTINGS = ["SET lock_timeout = '2s';", "SET deadlock_timeout = '5s';"];

// The phases, in the order deploy.sql applies them. A test asserts that.
const PHASES = [
  { name: "Phase 1: Types + Functions", file: "01_types_functions.sql" },
  { name: "Phase 2: Triggers", file: "02_triggers.sql" },
  { name: "Phase 3: Policies", file: "03_policies.sql" },
  { name: "Phase 4: Cron Jobs", file: "04_cron.sql" },
  { name: "Phase 5: Version stamp", file: "_version.sql" },
];

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

/**
 * Errors worth another attempt: the database refused this deploy because something else was
 * holding the object, not because the SQL is wrong.
 *
 *   40P01  deadlock detected           -- the policy phase against live traffic
 *   55P03  lock_not_available          -- our own lock_timeout expiring
 *   tuple concurrently updated         -- two sessions replacing the same pg_proc row, which is
 *                                         XX000 and has no code of its own
 *
 * Retrying is safe for every phase because every phase is idempotent by construction: the deploy
 * track applies `CREATE OR REPLACE`, `DROP ... IF EXISTS` and `cron.unschedule`-then-`schedule`,
 * and phases 1 to 3 roll back to a clean state before the retry starts.
 */
const RETRYABLE_PATTERNS = [
  /\b40P01\b/,
  /\b55P03\b/,
  /deadlock detected/i,
  /lock timeout/i,
  /tuple concurrently updated/i,
];

function isRetryableFailure(stderr) {
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(stderr || ""));
}

/** The `\i` order in deploy.sql, so the runner and the single-shot file cannot drift apart. */
function parsePhaseFilesFromDeploySql(sql) {
  return [...sql.matchAll(/^\\i\s+(\S+)\s*$/gm)].map((match) => match[1]);
}

/** The `SET` statements deploy.sql applies to the session, for the same reason. */
function parseSessionSettingsFromDeploySql(sql) {
  return [...sql.matchAll(/^SET\s+.*;$/gm)].map((match) => match[0]);
}

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

/**
 * psql runs every -c and -f in one session, in the order given, so the settings above are in
 * force for the phase file that follows them. They are sent as SQL rather than as PGOPTIONS
 * because the production connection goes through the Supabase pooler, which does not have to
 * forward startup options.
 */
function buildPsqlArgs({ connectionString, gitSha, phaseFile }) {
  const args = [connectionString, "-v", "ON_ERROR_STOP=1", "-v", `GIT_SHA=${gitSha}`];
  for (const setting of SESSION_SETTINGS) {
    args.push("-c", setting);
  }
  args.push("-f", phaseFile);
  return args;
}

// Synchronous, because the phase loop is: nothing else may run against the database while the
// deploy is between attempts.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPhase({ phase, connectionString, gitSha }) {
  const args = buildPsqlArgs({ connectionString, gitSha, phaseFile: phase.file });
  // stderr is captured so a failure can be classified; stdout still streams so the phase's own
  // \echo output appears while it runs.
  const result = spawnSync("psql", args, {
    cwd: dbDir,
    stdio: ["inherit", "inherit", "pipe"],
    encoding: "utf8",
    // Server NOTICEs come down stderr too -- a first deploy against an empty database emits one
    // per DROP ... IF EXISTS. Overflowing the default 1 MiB buffer kills the child, so the cap is
    // set far above anything a deploy produces.
    maxBuffer: 32 * 1024 * 1024,
  });

  const stderr = result.stderr || "";
  if (stderr) {
    process.stderr.write(stderr);
  }

  if (result.error) {
    return { code: 1, stderr: `${stderr}${result.error.message}\n` };
  }
  return { code: result.status ?? 1, stderr };
}

function reportFailure({ phase, phaseIndex, attempts, stderr, gitSha }) {
  const applied = PHASES.slice(0, phaseIndex).map((entry) => entry.name);
  const notApplied = PHASES.slice(phaseIndex + 1).map((entry) => entry.name);

  console.error("");
  console.error("==========================================");
  console.error(`DEPLOY FAILED in ${phase.name}`);
  console.error("==========================================");
  console.error(`Attempts:    ${attempts}`);
  console.error(`Applied:     ${applied.length ? applied.join(", ") : "none"}`);
  console.error(`Not applied: ${[phase.name, ...notApplied].join(", ")}`);
  console.error("");
  console.error(
    `The database is NOT at ${gitSha || "the checked-out commit"}. The version stamp did not run,`,
  );
  console.error(
    "so public.db_deploy_log still records the previous deploy -- read it, not this run, for",
  );
  console.error("what production is actually running.");
  if (isRetryableFailure(stderr)) {
    console.error("");
    console.error(
      "The failure is lock contention, so a re-run with the field clear is likely to succeed:",
    );
    console.error("every phase is idempotent and re-applies from the top.");
  }
  console.error("==========================================");
}

function main() {
  const args = process.argv.slice(2);
  const isLocal = args.includes("local");

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

  for (const [phaseIndex, phase] of PHASES.entries()) {
    console.log("");
    console.log(`=== ${phase.name} ===`);

    let last = { code: 1, stderr: "" };
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      last = runPhase({ phase, connectionString, gitSha });
      if (last.code === 0) {
        break;
      }
      if (!isRetryableFailure(last.stderr) || attempt === MAX_ATTEMPTS) {
        break;
      }
      console.error(
        `${phase.name}: lost a lock to another session (attempt ${attempt} of ${MAX_ATTEMPTS}); retrying in ${RETRY_DELAY_MS / 1000}s.`,
      );
      sleep(RETRY_DELAY_MS);
    }

    if (last.code !== 0) {
      reportFailure({ phase, phaseIndex, attempts, stderr: last.stderr, gitSha });
      process.exit(last.code);
    }
  }

  console.log("");
  console.log("==========================================");
  console.log(`Deploy complete: all ${PHASES.length} phases applied at ${gitSha || "unknown sha"}`);
  console.log("==========================================");
}

if (require.main === module) {
  main();
}

module.exports = {
  DEPLOY_SQL,
  MAX_ATTEMPTS,
  PHASES,
  SESSION_SETTINGS,
  buildPsqlArgs,
  getDatabaseUrlFromArgs,
  isRetryableFailure,
  parsePhaseFilesFromDeploySql,
  parseSessionSettingsFromDeploySql,
  readDeploySql: () => fs.readFileSync(DEPLOY_SQL, "utf8"),
};
