#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";

const DENO_LOCK = path.join(process.cwd(), "supabase", "functions", "deno.lock");
const DENO_LOCK_BAK = DENO_LOCK + ".bak";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function run(cmd, cmdArgs, envOverride = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    env: { ...process.env, ...envOverride },
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error(result.error.message);
  }
  return 1;
}

// Migrations are ordered by the timestamp in their filename, and a branch opened before another
// branch merges produces a file that sorts before a migration already applied to production. Plain
// `db push` refuses that file and keeps refusing it on every later push, so one out-of-order merge
// wedges the deploy until someone intervenes by hand. `--include-all` applies it in place instead.
// The full set is still proven to apply from scratch in filename order by the `db reset` CI lane.
//
// The schema moves before the functions do. The two orders protect opposite directions of a schema
// change, and this is the one that closes the common case outright: an additive migration (a new
// column, a new table) paired with a function that writes to it. With functions first there is a
// window in which the new function writes to a column that does not exist, and the failure is
// quiet -- T-0026 lost a review proposal that way while the run reported success. With the schema
// first the old function simply does not know about the new column, which costs nothing.
//
// What this order leaves unprotected: a migration that removes or renames something the deployed
// function still reads, between the migration landing and the function following it. The other
// order is unsafe for that case too, only in the opposite window, so a destructive migration is
// not made safe by reordering these steps in either direction. It has to ship as two changes: first
// a function that tolerates both shapes of the schema, then the migration that drops the old one.
// See T-260902-r9c in the task registry for the decision.
function buildSteps({ projectRef, databaseUrl }) {
  return [
    {
      cmd: NPX_BIN,
      args: ["supabase", "db", "push", "--include-all", "--yes", "--db-url", databaseUrl],
    },
    {
      cmd: "node",
      args: ["supabase/db/run-deploy.js"],
      env: { DATABASE_URL: databaseUrl },
    },
    {
      cmd: NPX_BIN,
      args: ["supabase", "functions", "deploy", "--project-ref", projectRef],
    },
  ];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target || "unknown";
  const projectRef = args["project-ref"];
  const databaseUrl = args["database-url"];

  if (!projectRef) {
    throw new Error("Missing --project-ref");
  }
  if (!databaseUrl) {
    throw new Error("Missing --database-url");
  }

  if (target !== "ci") {
    console.error(`WARNING: This command mutates remote Supabase state (target=${target}).`);
  }

  // Supabase edge runtime does not support Deno lockfile version 5 (Deno 2.x).
  // Move deno.lock aside during functions deploy so the bundler does not fail.
  const hadLock = fs.existsSync(DENO_LOCK);
  if (hadLock) {
    fs.renameSync(DENO_LOCK, DENO_LOCK_BAK);
  }

  try {
    const steps = buildSteps({ projectRef, databaseUrl });

    for (const { cmd, args: cmdArgs, env: envOverride } of steps) {
      const code = run(cmd, cmdArgs, envOverride || {});
      if (code !== 0) {
        process.exit(code);
      }
    }
  } finally {
    if (hadLock && fs.existsSync(DENO_LOCK_BAK)) {
      fs.renameSync(DENO_LOCK_BAK, DENO_LOCK);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildSteps, parseArgs };
