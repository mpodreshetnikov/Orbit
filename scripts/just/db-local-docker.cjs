#!/usr/bin/env node
/**
 * Brings up a local Supabase database without `supabase start`, for hosts the CLI cannot serve.
 *
 * `supabase start` seeds Realtime on first boot, and that seeding opens an IPv6 listener. A
 * kernel booted with `ipv6.disable=1` — which is what agent containers get — fails it with
 * `:eafnosupport`, the CLI tears the whole stack down, and every database check becomes
 * unavailable: `db-reset`, `db-test`, `db-lint`, `db-artifacts`. T-0013 was written that way,
 * with six migrations and five pgTAP files pushed unexecuted, and the first CI run of that SQL
 * found four defects that no unit test of any single layer could see.
 *
 * Nothing about that is inherent to Postgres. This script starts the same `supabase/postgres`
 * image directly and applies the same files in the same order the CLI would, then borrows the
 * storage and auth images for one job each: creating the schemas their services own, which the
 * repository's own migrations then build on. What it deliberately does not provide is the API
 * layer — PostgREST, Kong, the edge runtime — so it serves the SQL checks, not end-to-end
 * tests.
 *
 *   node scripts/just/db-local-docker.cjs up | down | test | lint | url
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ensureDockerReady } = require("./docker-preflight.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");

const DB_CONTAINER = process.env.ORBIT_DB_CONTAINER ?? "orbit_db";
const STORAGE_CONTAINER = "orbit_db_storage";
const AUTH_CONTAINER = "orbit_db_auth";
const PORT = Number(process.env.ORBIT_DB_PORT ?? 54322);
/**
 * The registry the Supabase CLI is configured to use, which CI sets to ghcr.io.
 *
 * Hard-coding public.ecr.aws made this script pull images the runner already had under another
 * name — and pay the public registry's rate limit for it, which is exactly how the first CI run
 * of the migration check failed: `toomanyrequests: Rate exceeded`. Following the CLI's own
 * setting means the images are already on disk wherever the CLI has run.
 */
const IMAGE_REGISTRY = process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY ?? "public.ecr.aws";
const PG_IMAGE = process.env.ORBIT_PG_IMAGE ?? `${IMAGE_REGISTRY}/supabase/postgres:17.6.1.063`;
const STORAGE_IMAGE =
  process.env.ORBIT_STORAGE_IMAGE ?? `${IMAGE_REGISTRY}/supabase/storage-api:v1.38.0`;
const AUTH_IMAGE = process.env.ORBIT_AUTH_IMAGE ?? `${IMAGE_REGISTRY}/supabase/gotrue:v2.186.0`;
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

/** What the app, psql and `run-deploy.js` connect to. */
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

function log(message) {
  console.log(`[db-local-docker] ${message}`);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: "postgres", ...(options.env ?? {}) },
  });
}

function docker(args, options = {}) {
  return run("docker", args, { stdio: "pipe", ...options });
}

/**
 * Fails now, with the reason, rather than in three minutes with the wrong one.
 *
 * Every command here shells out to a host `psql`, which the repository's prerequisites do not
 * ask for — Docker, Node, Deno and the Supabase CLI, but no Postgres client. Without it
 * `spawnSync` returns ENOENT, `up` reads that as "not ready yet" and polls until it times out
 * reporting that PostgreSQL never came up. The container is fine; the client is missing.
 */
function requirePsqlClient() {
  const probe = spawnSync("psql", ["--version"], { stdio: "pipe", encoding: "utf8" });
  if (probe.error?.code === "ENOENT") {
    throw new Error(
      "psql was not found on PATH. This script drives the container through the host's " +
        "PostgreSQL client: install it (Debian/Ubuntu `apt-get install -y postgresql-client`, " +
        "macOS `brew install libpq`) and run the command again.",
    );
  }
}

function psql(args, options = {}) {
  return run(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(PORT),
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      ...args,
    ],
    { stdio: "pipe", ...options },
  );
}

/** Runs as the image's own superuser; the published `postgres` role is not one. */
function psqlSuper(sql) {
  return docker([
    "exec",
    DB_CONTAINER,
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-q",
    "-c",
    sql,
  ]);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitFor(label, check, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    sleep(2000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function startDatabase() {
  log("recreating containers");
  docker(["rm", "-f", DB_CONTAINER, STORAGE_CONTAINER, AUTH_CONTAINER]);
  const created = docker([
    "run",
    "-d",
    "--name",
    DB_CONTAINER,
    "-p",
    `${PORT}:5432`,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    PG_IMAGE,
    "postgres",
    "-c",
    "config_file=/etc/postgresql/postgresql.conf",
  ]);
  if (created.status !== 0) {
    throw new Error(`Failed to start ${DB_CONTAINER}: ${created.stderr ?? ""}`);
  }

  log("waiting for postgres");
  waitFor("postgres", () => psql(["-c", "select 1"]).status === 0);

  log("granting local superuser access and setting service role passwords");
  docker([
    "exec",
    DB_CONTAINER,
    "bash",
    "-lc",
    "grep -q '^local all all trust' /etc/postgresql/pg_hba.conf || " +
      "sed -i '1i local all all trust' /etc/postgresql/pg_hba.conf",
  ]);
  psql(["-c", "select pg_reload_conf()"]);
  psqlSuper(
    "alter role supabase_storage_admin with password 'postgres' login;" +
      "alter role supabase_auth_admin with password 'postgres' login;" +
      "alter role authenticator with password 'postgres' login;" +
      "alter role supabase_admin with password 'postgres' login;",
  );
}

function startSchemaOwners() {
  // The storage and auth schemas belong to their services, not to this repository's migrations
  // — but the migrations build on them (`20250126000004_storage_policies.sql` inserts a bucket,
  // and `seed.sql` writes an `auth.users` row), so both services run their own migrations here
  // before ours do. The CLI reaches the same state by starting the full stack.
  log("starting storage-api so it migrates the storage schema");
  // Checked, unlike before: a `docker run` that fails — an image that cannot be pulled, most
  // often — used to surface three minutes later as "Timed out waiting for storage schema",
  // which names the symptom and hides the cause. That is exactly how it failed in CI.
  const storage = docker([
    "run",
    "-d",
    "--name",
    STORAGE_CONTAINER,
    "--network",
    "host",
    "-e",
    "ANON_KEY=stub",
    "-e",
    "SERVICE_KEY=stub",
    "-e",
    `PGRST_JWT_SECRET=${JWT_SECRET}`,
    "-e",
    `DATABASE_URL=postgresql://supabase_storage_admin:postgres@127.0.0.1:${PORT}/postgres`,
    "-e",
    "FILE_SIZE_LIMIT=52428800",
    "-e",
    "STORAGE_BACKEND=file",
    "-e",
    "FILE_STORAGE_BACKEND_PATH=/var/lib/storage",
    "-e",
    "TENANT_ID=stub",
    "-e",
    "REGION=stub",
    "-e",
    "GLOBAL_S3_BUCKET=stub",
    "-e",
    "ENABLE_IMAGE_TRANSFORMATION=false",
    STORAGE_IMAGE,
  ]);
  if (storage.status !== 0) {
    throw new Error(`Failed to start ${STORAGE_CONTAINER}: ${storage.stderr?.trim() ?? ""}`);
  }
  waitFor("storage schema", () => {
    const result = psql(["-Atc", "select to_regclass('storage.buckets') is not null"]);
    return result.status === 0 && result.stdout.trim() === "t";
  });

  log("starting gotrue so it migrates the auth schema");
  const auth = docker([
    "run",
    "-d",
    "--name",
    AUTH_CONTAINER,
    "--network",
    "host",
    "-e",
    "GOTRUE_DB_DRIVER=postgres",
    "-e",
    `GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin:postgres@127.0.0.1:${PORT}/postgres`,
    "-e",
    "GOTRUE_SITE_URL=http://localhost:3000",
    "-e",
    "GOTRUE_API_HOST=0.0.0.0",
    "-e",
    "PORT=9999",
    "-e",
    "API_EXTERNAL_URL=http://localhost:9999",
    "-e",
    `GOTRUE_JWT_SECRET=${JWT_SECRET}`,
    "-e",
    "GOTRUE_JWT_EXP=3600",
    "-e",
    "GOTRUE_JWT_AUD=authenticated",
    "-e",
    "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
    AUTH_IMAGE,
  ]);
  if (auth.status !== 0) {
    throw new Error(`Failed to start ${AUTH_CONTAINER}: ${auth.stderr?.trim() ?? ""}`);
  }
  waitFor("auth schema", () => {
    const result = psql([
      "-Atc",
      "select count(*) from information_schema.columns where table_schema='auth' " +
        "and table_name='users' and column_name='email_confirmed_at'",
    ]);
    return result.status === 0 && result.stdout.trim() === "1";
  });
}

/**
 * `from` and `until` are inclusive migration version prefixes. They exist so a caller can stop
 * before a migration, put rows in the shape that migration was written to repair, and then run
 * it — which is the only way to test a data-repairing migration against anything but the empty
 * tables CI holds.
 */
function applyMigrations({ from, until } = {}) {
  log("applying migrations");
  psql([
    "-c",
    "create schema if not exists supabase_migrations;" +
      "create table if not exists supabase_migrations.schema_migrations " +
      "(version text primary key, statements text[], name text);",
  ]);

  const migrationsDir = path.join(repoRoot, "supabase", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => {
      const version = name.split("_")[0];
      if (from && version < from) return false;
      if (until && version > until) return false;
      return true;
    })
    .sort();
  for (const name of files) {
    const applied = psql(["-f", path.join(migrationsDir, name)], { stdio: "pipe" });
    if (applied.status !== 0) {
      console.error(applied.stderr ?? "");
      throw new Error(`Migration failed: ${name}`);
    }
    psql([
      "-c",
      `insert into supabase_migrations.schema_migrations (version, name) values ` +
        `('${name.split("_")[0]}', '${name}') on conflict do nothing;`,
    ]);
  }
  log(`applied ${files.length} migration(s)`);
}

function applyDeployAndSeed() {
  log("applying idempotent SQL objects (supabase/db/deploy.sql)");
  // Not `run-deploy.js local`: that mode hard-codes port 54322, so a database on any other port
  // would either fail to connect or — worse, if a stock Supabase stack holds 54322 — deploy into
  // the wrong database while reporting success.
  const deployed = run("node", [
    path.join("supabase", "db", "run-deploy.js"),
    "--database-url",
    DB_URL,
  ]);
  if (deployed.status !== 0) throw new Error("run-deploy.js failed");

  log("installing pgtap for the pgTAP suite");
  psqlSuper("create extension if not exists pgtap with schema extensions;");

  log("seeding");
  const seeded = psql(["-f", path.join(repoRoot, "supabase", "seed.sql")], { stdio: "pipe" });
  if (seeded.status !== 0) {
    console.error(seeded.stderr ?? "");
    throw new Error("seed.sql failed");
  }
}

function up(flags) {
  const dockerStatus = ensureDockerReady();
  if (dockerStatus !== 0) return dockerStatus;

  startDatabase();
  startSchemaOwners();
  applyMigrations({ until: flags.until });
  if (!flags.noDeploy) applyDeployAndSeed();

  log("ready");
  log(`  psql / app:   ${DB_URL}`);
  return 0;
}

function down() {
  docker(["rm", "-f", DB_CONTAINER, STORAGE_CONTAINER, AUTH_CONTAINER]);
  log("removed");
  return 0;
}

/**
 * Runs the pgTAP suite through psql rather than the CLI.
 *
 * `supabase test db` launches pg_prove in its own container, which cannot reach a database
 * published on the host's loopback — and pointing it at the container name instead made the CLI
 * demand TLS, because a name it does not recognise is "remote" to it. Working around that took a
 * self-signed certificate, an /etc/hosts entry needing root, and a claim on port 5432 that
 * collides with any Postgres already running. All three were workarounds for a runner this
 * script does not need: a pgTAP file is a psql script, and its output is TAP.
 *
 * CI still runs the CLI against its own stack, so parity with the pipeline is unaffected.
 */
function test(paths) {
  const roots = paths.length > 0 ? paths : [path.join("supabase", "tests")];
  const files = [];
  const collect = (target) => {
    const absolute = path.resolve(repoRoot, target);
    if (!fs.existsSync(absolute)) return;
    if (fs.statSync(absolute).isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) collect(path.join(target, entry));
      return;
    }
    if (absolute.endsWith(".sql")) files.push(absolute);
  };
  for (const root of roots) collect(root);

  if (files.length === 0) {
    log("no pgTAP files found");
    return 1;
  }

  let failed = 0;
  let assertions = 0;
  for (const file of files) {
    const result = psql(["-X", "-t", "-A", "-f", file], { env: { ON_ERROR_STOP: "0" } });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const notOk = output.match(/^not ok\b.*$/gm) ?? [];
    const ok = output.match(/^ok\b/gm) ?? [];
    assertions += ok.length + notOk.length;

    // A pgTAP file opens with `plan(n)` and that number is the contract. Counting `ok` lines
    // alone accepts a file that declared twenty assertions and emitted twelve before execution
    // stopped somewhere that raised no SQL error — no `not ok`, a non-empty `ok` list, green.
    // `pg_prove`, which this replaced, treats a plan mismatch as a failure, and so must this or
    // the replacement is weaker than what it stands in for.
    const planned = Number(output.match(/^1\.\.(\d+)$/m)?.[1] ?? NaN);
    const emitted = ok.length + notOk.length;
    const planMismatch = Number.isFinite(planned) && planned !== emitted;

    const relative = path.relative(repoRoot, file);
    if (notOk.length > 0 || result.status !== 0 || ok.length === 0 || planMismatch) {
      failed += 1;
      console.log(`not ok - ${relative}`);
      for (const line of notOk) console.log(`    ${line}`);
      if (planMismatch) {
        console.log(`    plan declared ${planned} assertion(s), ${emitted} emitted`);
      }
      if (ok.length === 0) console.log(`    ${output.trim().split("\n").slice(-5).join("\n    ")}`);
      continue;
    }
    console.log(`ok - ${relative} (${ok.length})`);
  }

  log(`${files.length} file(s), ${assertions} assertion(s), ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

function lint() {
  const result = run("npx", [
    "supabase",
    "db",
    "lint",
    "--db-url",
    DB_URL,
    "--schema",
    "public",
    "--fail-on",
    "warning",
  ]);
  return result.status ?? 1;
}

const [command = "up", ...rest] = process.argv.slice(2);

function flagValue(name) {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

const flags = {
  until: flagValue("--until"),
  from: flagValue("--from"),
  noDeploy: rest.includes("--no-deploy"),
  noTls: rest.includes("--no-tls"),
};
const positional = rest.filter(
  (token, index) =>
    !token.startsWith("--") && !["--until", "--from"].includes(rest[index - 1] ?? ""),
);

const commands = {
  up: () => {
    requirePsqlClient();
    return up(flags);
  },
  down,
  migrate: () => {
    requirePsqlClient();
    applyMigrations({ from: flags.from, until: flags.until });
    return 0;
  },
  test: () => {
    requirePsqlClient();
    return test(positional);
  },
  lint,
  // `url` only prints a string, and `down` only stops containers: neither touches the client.
  url: () => {
    console.log(DB_URL);
    return 0;
  },
};

if (!Object.hasOwn(commands, command)) {
  console.error(`Unknown command: ${command}. Use one of: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

try {
  process.exit(commands[command]());
} catch (error) {
  console.error(`[db-local-docker] ${error.message}`);
  process.exit(1);
}
