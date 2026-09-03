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

// Lock behaviour for every phase: the deploy gives a contended lock up itself, quickly and with a
// named error, rather than waiting long enough for the deadlock detector to choose a victim at an
// arbitrary point.
//
// It gets there by ducking under deadlock_timeout rather than by raising it. deadlock_timeout is
// a superuser-only parameter (`context = 'superuser'` in pg_settings) and the deploy connects as
// `postgres`, which is not a superuser on Supabase, so setting it fails outright and takes the
// phase down with it under ON_ERROR_STOP. Its default is 1000ms, so a lock_timeout below that
// expires first and the deploy loses on its own terms. lock_timeout itself is `context = 'user'`
// and needs no privilege.
//
// deploy.sql sets the same values for a manual single-shot run, and a test asserts the two stay
// identical and that neither touches a parameter the deploy role cannot set.
const SESSION_SETTINGS = ["SET lock_timeout = '750ms';"];

// The phases, in the order deploy.sql applies them. A test asserts that.
//
// `unit` is what a failure leaves behind, which the failure report has to say honestly:
//   transaction  the file is one BEGIN/COMMIT, so a failure rolls the whole phase back;
//   file         the phase is a list of `\i` files, each its own transaction, applied here one
//                psql invocation at a time so that the report can count the files that committed
//                before the one that failed -- a policy phase that loses its last retry halfway
//                is partially deployed, and saying "not applied" about it would misdirect the
//                recovery;
//   statement    autocommit, so every statement before the failing one is committed and a re-run
//                converges.
const PHASES = [
  { name: "Phase 1: Types + Functions", file: "01_types_functions.sql", unit: "transaction" },
  { name: "Phase 2: Triggers", file: "02_triggers.sql", unit: "transaction" },
  { name: "Phase 3: Policies", file: "03_policies.sql", unit: "file" },
  { name: "Phase 4: Cron Jobs", file: "04_cron.sql", unit: "statement" },
  { name: "Phase 5: Version stamp", file: "_version.sql", unit: "statement" },
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
function buildPsqlArgs({ connectionString, gitSha, phaseFile, singleTransaction = false }) {
  const args = [connectionString, "-v", "ON_ERROR_STOP=1", "-v", `GIT_SHA=${gitSha}`];
  for (const setting of SESSION_SETTINGS) {
    args.push("-c", setting);
  }
  // A policy file applied on its own gets the BEGIN/COMMIT that 03_policies.sql wraps it in
  // when the phase is applied as one file; psql's flag does exactly that around all of -c/-f.
  if (singleTransaction) {
    args.push("--single-transaction");
  }
  args.push("-f", phaseFile);
  return args;
}

/** The files a `file`-unit phase applies, one transaction each: its `\i` lines, in order. */
function phaseUnits(phase) {
  if (phase.unit !== "file") {
    return [phase.file];
  }
  return parsePhaseFilesFromDeploySql(fs.readFileSync(path.join(dbDir, phase.file), "utf8"));
}

// Synchronous, because the phase loop is: nothing else may run against the database while the
// deploy is between attempts.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPsql({ connectionString, gitSha, phaseFile, singleTransaction }) {
  const args = buildPsqlArgs({ connectionString, gitSha, phaseFile, singleTransaction });
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

/**
 * Applies one unit of a phase with the bounded retry, and says how many attempts it took.
 */
function applyWithRetry({ label, connectionString, gitSha, phaseFile, singleTransaction }) {
  let last = { code: 1, stderr: "" };
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    last = runPsql({ connectionString, gitSha, phaseFile, singleTransaction });
    if (last.code === 0) {
      break;
    }
    if (!isRetryableFailure(last.stderr) || attempt === MAX_ATTEMPTS) {
      break;
    }
    console.error(
      `${label}: lost a lock to another session (attempt ${attempt} of ${MAX_ATTEMPTS}); retrying in ${RETRY_DELAY_MS / 1000}s.`,
    );
    sleep(RETRY_DELAY_MS);
  }
  return { ...last, attempts };
}

/**
 * Applies a phase unit by unit. On failure, `applied` names the units that committed before the
 * failing one, which for a `file` phase is the honest count of what production now has.
 */
function runPhase({ phase, connectionString, gitSha }) {
  const units = phaseUnits(phase);
  const applied = [];
  for (const unit of units) {
    const result = applyWithRetry({
      label: units.length > 1 ? `${phase.name} (${unit})` : phase.name,
      connectionString,
      gitSha,
      phaseFile: unit,
      singleTransaction: phase.unit === "file",
    });
    if (result.code !== 0) {
      return { ...result, applied, failedUnit: unit, units };
    }
    applied.push(unit);
  }
  return { code: 0, stderr: "", attempts: 1, applied, failedUnit: null, units };
}

/**
 * The failure report, as lines. What it says about the failed phase depends on the phase's unit,
 * because that is what decides what production is left with: a rolled-back transaction leaves
 * nothing; a file phase leaves every file that committed before the failing one; an autocommit
 * phase leaves every statement before the failing one.
 */
function failureReport({ phase, phaseIndex, attempts, stderr, gitSha, applied = [], failedUnit }) {
  const before = PHASES.slice(0, phaseIndex).map((entry) => entry.name);
  const after = PHASES.slice(phaseIndex + 1).map((entry) => entry.name);
  const lines = [];

  lines.push("");
  lines.push("==========================================");
  lines.push(`DEPLOY FAILED in ${phase.name}`);
  lines.push("==========================================");
  lines.push(
    `Attempts:    ${attempts}${failedUnit && failedUnit !== phase.file ? ` (on ${failedUnit})` : ""}`,
  );
  lines.push(`Applied:     ${before.length ? before.join(", ") : "none"}`);

  if (phase.unit === "file") {
    const total = phaseUnits(phase).length;
    const last = applied.length ? applied[applied.length - 1] : null;
    lines.push(
      `Partially applied: ${phase.name} -- ${applied.length} of ${total} files committed` +
        (last ? `, up to ${last}` : "") +
        `; ${failedUnit} failed, and it and the ${total - applied.length - 1} files after it are not applied.`,
    );
  } else if (phase.unit === "statement") {
    lines.push(
      `Partially applied: ${phase.name} -- it runs in autocommit, so every statement before the failing one is committed; a re-run converges.`,
    );
  } else {
    lines.push(`Rolled back:   ${phase.name} -- one transaction, so nothing of it is applied.`);
  }

  lines.push(`Not applied: ${after.length ? after.join(", ") : "none"}`);
  lines.push("");
  lines.push(
    `The database is NOT at ${gitSha || "the checked-out commit"}. The version stamp did not run,`,
  );
  lines.push(
    "so public.db_deploy_log still records the previous deploy -- read it, not this run, for",
  );
  lines.push("what production is actually running.");
  if (isRetryableFailure(stderr)) {
    lines.push("");
    lines.push(
      "The failure is lock contention, so a re-run with the field clear is likely to succeed:",
    );
    lines.push("every phase is idempotent and re-applies from the top.");
  }
  lines.push("==========================================");
  return lines;
}

function reportFailure(input) {
  for (const line of failureReport(input)) {
    console.error(line);
  }
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

    const result = runPhase({ phase, connectionString, gitSha });
    if (result.code !== 0) {
      reportFailure({
        phase,
        phaseIndex,
        attempts: result.attempts,
        stderr: result.stderr,
        gitSha,
        applied: result.applied,
        failedUnit: result.failedUnit,
      });
      process.exit(result.code);
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
  failureReport,
  getDatabaseUrlFromArgs,
  isRetryableFailure,
  parsePhaseFilesFromDeploySql,
  parseSessionSettingsFromDeploySql,
  phaseUnits,
  readDeploySql: () => fs.readFileSync(DEPLOY_SQL, "utf8"),
};
