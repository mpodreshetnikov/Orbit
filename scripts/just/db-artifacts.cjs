#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ensureDockerReady } = require("./docker-preflight.cjs");

const PG_DUMP_BIN = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
const verifyMode = process.argv.includes("--verify");
const repoRoot = path.resolve(__dirname, "..", "..");
const SCHEMA_SNAPSHOT_PATH = path.join(repoRoot, "supabase", "db", "schema.snapshot.sql");
const DB_TYPES_PATH = path.join(repoRoot, "supabase", "db", "database.types.ts");

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.captureOutput ? "utf8" : undefined,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });

  if (typeof result.status === "number") {
    return result;
  }

  return {
    ...result,
    status: 1,
  };
}

function runJust(recipe) {
  return run(JUST_BIN, [recipe]);
}

function runOrExit(command, args, options = {}) {
  const result = run(command, args, options);
  return result;
}

function runSupabaseCli(args, options = {}) {
  if (process.platform === "win32") {
    return run("cmd.exe", ["/d", "/c", "npx", "supabase", ...args], options);
  }

  return run("npx", ["supabase", ...args], options);
}

function parseStatusEnvOutput(output) {
  const envValues = {};
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    envValues[key] = value;
  }

  return envValues;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getLocalDbUrl() {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const statusResult = runSupabaseCli(["status", "-o", "env"], {
      captureOutput: true,
    });

    const combinedOutput = `${statusResult.stdout ?? ""}\n${statusResult.stderr ?? ""}`;
    if (statusResult.status === 0) {
      const envValues = parseStatusEnvOutput(combinedOutput);
      if (envValues.DB_URL) {
        return envValues.DB_URL;
      }

      const prettyUrlMatch = combinedOutput.match(/postgresql:\/\/[^\s"]+/);
      if (prettyUrlMatch) {
        return prettyUrlMatch[0];
      }
    }

    if (attempt === 8) {
      if (statusResult.stdout) process.stdout.write(statusResult.stdout);
      if (statusResult.stderr) process.stderr.write(statusResult.stderr);
      return null;
    }

    sleepMs(1000);
  }

  return null;
}

function buildPgDumpConfig(dbUrl) {
  const parsed = new URL(dbUrl);
  const dbName = parsed.pathname.replace(/^\//, "");
  const username = decodeURIComponent(parsed.username || "");

  if (!dbName || !username) {
    throw new Error("DB_URL is missing required database name or username.");
  }

  const args = [
    "--schema-only",
    "--quote-all-identifiers",
    "--role",
    username,
    "--schema=public",
    "--table=public.*",
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    "--no-publications",
    "--no-subscriptions",
    "--no-security-labels",
    "--host",
    parsed.hostname,
    "--port",
    parsed.port || "5432",
    "--username",
    username,
    "--dbname",
    dbName,
  ];

  const password = decodeURIComponent(parsed.password || "");
  const env = password.length > 0 ? { PGPASSWORD: password } : {};

  return { args, env };
}

/**
 * Strip what the dump says about the tools rather than about the schema.
 *
 * pg_dump stamps its own exact build and the server's into every section header --
 * `-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-1.pgdg24.04+2)`. Keeping that makes the snapshot
 * a function of whichever patch release the runner installed that morning, so the next PGDG minor
 * would report drift on a schema nobody touched and block every DB-impacting pull request until
 * someone regenerated. Pinning the exact patch instead is not an option that survives: the
 * previous snapshot was made with pg_dump 18.1, which PGDG no longer publishes.
 */
function sanitizeCommonSql(sql) {
  return sql
    .replace(/^\s*\\(?:un)?restrict\b.*(?:\r?\n|$)/gim, "")
    .replace(/^\s*SET\s+transaction_timeout\s*=\s*0;\s*(?:\r?\n|$)/gim, "")
    .replace(/^--\s*Dumped (?:from database|by pg_dump) version .*(?:\r?\n|$)/gim, "");
}

function stripPolicyAndRlsSql(sql) {
  return sql
    .replace(/^\s*CREATE\s+POLICY\b[\s\S]*?;\s*/gim, "")
    .replace(/^\s*ALTER\s+POLICY\b[\s\S]*?;\s*/gim, "")
    .replace(
      /^\s*ALTER\s+TABLE\s+.+\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY;\s*(?:\r?\n|$)/gim,
      "",
    );
}

function stripTriggerSql(sql) {
  return sql.replace(/^\s*CREATE\s+TRIGGER\b[\s\S]*?;\s*/gim, "");
}

function assertTableOnlySnapshot(sql) {
  const forbiddenPatterns = [
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
    /\bCREATE\s+POLICY\b/i,
    /\bALTER\s+POLICY\b/i,
    /\bCREATE\s+TRIGGER\b/i,
    /\b(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/i,
    /^\s*(GRANT|REVOKE)\b/im,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(sql)) {
      throw new Error(`Snapshot contains forbidden statement matching pattern: ${pattern}`);
    }
  }
}

/**
 * The oldest pg_dump that can produce this snapshot, regardless of what the server is.
 *
 * `--no-policies` arrives in pg_dump 18; a 17 client rejects the flag outright and the dump never
 * runs. So the client has to clear two separate bars — the server's major version, because pg_dump
 * refuses a newer server, and this one, because the snapshot is defined by flags only 18 knows.
 * Raising this means every developer and the runner need the newer client.
 */
const MIN_PG_DUMP_MAJOR = 18;

/** The leading integer of a `pg_dump (PostgreSQL) 17.6` banner, or null when it is unreadable. */
function parsePgDumpMajor(versionOutput) {
  const match = /PostgreSQL\)?\s+(\d+)/i.exec(String(versionOutput ?? ""));
  return match ? Number(match[1]) : null;
}

/** The `major_version` the local database is pinned to in `supabase/config.toml`. */
function readConfiguredMajorVersion(configPath = path.join(repoRoot, "supabase", "config.toml")) {
  let contents;
  try {
    contents = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  const match = /^\s*major_version\s*=\s*(\d+)/m.exec(contents);
  return match ? Number(match[1]) : null;
}

/**
 * Refuse a dump the client cannot produce, and say what to install.
 *
 * pg_dump refuses a server newer than itself, which is a normal thing to get wrong: the database
 * is pinned by `supabase/config.toml` while pg_dump comes from whatever the machine happens to
 * have. On the CI runner that was `pg_dump` 16 against a 17.6 database, so the snapshot was never
 * regenerated -- and because the failure was swallowed, the check reported success. Checking up
 * front turns "aborting because of server version mismatch" into a sentence that names the fix.
 */
function assertPgDumpMajorMatches(clientMajor, serverMajor) {
  if (clientMajor === null) return;
  const required = Math.max(serverMajor ?? 0, MIN_PG_DUMP_MAJOR);
  if (clientMajor >= required) return;

  const because =
    serverMajor !== null && serverMajor > MIN_PG_DUMP_MAJOR
      ? `supabase/config.toml pins the database to ${serverMajor}, and pg_dump cannot dump a newer server`
      : `this snapshot is defined with --no-policies, which pg_dump only understands from ${MIN_PG_DUMP_MAJOR}`;

  throw new Error(
    `pg_dump is version ${clientMajor}, but ${required} or newer is required: ${because}. ` +
      `The snapshot would never be written. Install postgresql-client-${required} (or newer) and ` +
      `put it ahead of pg_dump ${clientMajor} on PATH.`,
  );
}

function generateTableOnlySnapshot() {
  const versionResult = run(PG_DUMP_BIN, ["--version"], { captureOutput: true });
  if (versionResult.status !== 0) {
    if (versionResult.stdout) process.stdout.write(versionResult.stdout);
    if (versionResult.stderr) process.stderr.write(versionResult.stderr);
    throw new Error("pg_dump is required to generate table-only schema snapshot.");
  }
  assertPgDumpMajorMatches(parsePgDumpMajor(versionResult.stdout), readConfiguredMajorVersion());

  const dbUrl = getLocalDbUrl();
  if (!dbUrl) {
    throw new Error("Unable to resolve DB_URL from `supabase status -o env`.");
  }

  const { args: baseArgs, env } = buildPgDumpConfig(dbUrl);
  const preResult = run(PG_DUMP_BIN, [...baseArgs, "--section=pre-data"], {
    captureOutput: true,
    env,
  });
  if (preResult.status !== 0) {
    if (preResult.stdout) process.stdout.write(preResult.stdout);
    if (preResult.stderr) process.stderr.write(preResult.stderr);
    throw new Error("Failed dumping pre-data table schema.");
  }

  const postResult = run(PG_DUMP_BIN, [...baseArgs, "--section=post-data", "--no-policies"], {
    captureOutput: true,
    env,
  });
  if (postResult.status !== 0) {
    if (postResult.stdout) process.stdout.write(postResult.stdout);
    if (postResult.stderr) process.stderr.write(postResult.stderr);
    throw new Error("Failed dumping post-data table schema.");
  }

  const preSql = sanitizeCommonSql(preResult.stdout ?? "");
  const postSql = stripPolicyAndRlsSql(stripTriggerSql(sanitizeCommonSql(postResult.stdout ?? "")));
  const snapshotSql = `${preSql.trimEnd()}\n\n${postSql.trimStart()}`;
  assertTableOnlySnapshot(snapshotSql);

  fs.writeFileSync(SCHEMA_SNAPSHOT_PATH, `${snapshotSql.trimEnd()}\n`, "utf8");
}

/**
 * Regenerate both artifacts, and in verify mode fail when they differ from what is committed.
 *
 * **Returns the exit code; it never sets one and returns nothing.** That shape is the whole point.
 * The previous version set an `exitCode` variable and used a bare `return` on every failure path,
 * with `process.exit(exitCode)` after the enclosing `try/finally` — where a `return` inside the
 * `try` never reaches it. Every failure, including "artifacts are out of date", exited 0, which is
 * how this check passed for months while regenerating nothing. A function that returns its status
 * cannot fail that way: a bare `return` would be `undefined`, not a silent success.
 *
 * `state.started` is out-parameter rather than local because the caller has to stop a stack this
 * function started even when it throws.
 */
function runArtifacts(state) {
  const reuseSupabase = process.env.SUPABASE_ALREADY_RUNNING === "1";

  if (!reuseSupabase) {
    const startResult = runOrExit(JUST_BIN, ["supabase-local-start"]);
    if (startResult.status !== 0) return startResult.status ?? 1;
    state.started = true;
  }

  const resetDeployResult = runOrExit(JUST_BIN, ["supabase-local-reset-and-deploy"]);
  if (resetDeployResult.status !== 0) return resetDeployResult.status ?? 1;

  try {
    generateTableOnlySnapshot();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Failed generating table-only schema snapshot.",
    );
    return 1;
  }

  const typesResult = runSupabaseCli(
    ["gen", "types", "--local", "--lang", "typescript", "--schema", "public"],
    { captureOutput: true },
  );

  if (typesResult.status !== 0) {
    if (typesResult.stdout) process.stdout.write(typesResult.stdout);
    if (typesResult.stderr) process.stderr.write(typesResult.stderr);
    return typesResult.status ?? 1;
  }

  fs.writeFileSync(DB_TYPES_PATH, typesResult.stdout, "utf8");

  if (verifyMode) {
    const diffResult = run("git", [
      "diff",
      "--exit-code",
      "--",
      "supabase/db/schema.snapshot.sql",
      "supabase/db/database.types.ts",
    ]);
    if (diffResult.status !== 0) {
      console.error("Generated DB artifacts are out of date.");
      console.error("Run: just supabase-local-artifacts-refresh");
      return diffResult.status ?? 1;
    }
  }

  return 0;
}

function main() {
  const dockerReadyCode = ensureDockerReady();
  if (dockerReadyCode !== 0) {
    process.exit(dockerReadyCode);
  }

  const state = { started: false };
  let exitCode;

  try {
    exitCode = runArtifacts(state);
  } finally {
    // Stop a stack this run started, whether it finished or threw. Nothing here decides the exit:
    // an unexpected exception -- a read-only workspace, a full disk -- must keep propagating and
    // end the process with a stack trace rather than be converted into a silent success, which is
    // the same false green in a different disguise.
    if (state.started) {
      const stopResult = runJust("supabase-local-stop");
      if (exitCode === 0 && stopResult.status !== 0) {
        exitCode = stopResult.status ?? 1;
      }
    }
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  assertPgDumpMajorMatches,
  sanitizeCommonSql,
  parsePgDumpMajor,
  readConfiguredMajorVersion,
};
