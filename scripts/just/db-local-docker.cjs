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
const NETWORK = process.env.ORBIT_DB_NETWORK ?? "orbit_db_net";
const PORT = Number(process.env.ORBIT_DB_PORT ?? 54322);
const PG_IMAGE = process.env.ORBIT_PG_IMAGE ?? "public.ecr.aws/supabase/postgres:17.6.1.063";
const STORAGE_IMAGE =
  process.env.ORBIT_STORAGE_IMAGE ?? "public.ecr.aws/supabase/storage-api:v1.38.0";
const AUTH_IMAGE = process.env.ORBIT_AUTH_IMAGE ?? "public.ecr.aws/supabase/gotrue:v2.186.0";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

/** What the app, psql and `run-deploy.js` connect to. */
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
/** What the pgTAP runner connects to — it is a container, so loopback is not the database. */
const CONTAINER_DB_URL = `postgresql://postgres:postgres@${DB_CONTAINER}:5432/postgres`;

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

function pinContainerNameToLoopback() {
  // The pgTAP runner is a container on ${NETWORK} while the CLI that launches it runs on the
  // host, and both are handed the same connection string. One name has to resolve in both
  // places: inside the network Docker's DNS answers it, and here /etc/hosts does.
  if (process.platform !== "linux") return;
  const hosts = fs.readFileSync("/etc/hosts", "utf8");
  if (new RegExp(`\\s${DB_CONTAINER}(\\s|$)`, "m").test(hosts)) return;
  fs.appendFileSync("/etc/hosts", `\n127.0.0.1 ${DB_CONTAINER}\n`);
}

function enableTls() {
  // The CLI refuses a plaintext connection to anything it does not consider local, and the
  // container name is not local by its reckoning. A self-signed certificate is enough: this
  // database holds fixtures and lives as long as the checkout.
  docker([
    "exec",
    DB_CONTAINER,
    "bash",
    "-lc",
    "test -f /var/lib/postgresql/server.crt || (openssl req -new -x509 -days 365 -nodes -text " +
      "-out /var/lib/postgresql/server.crt -keyout /var/lib/postgresql/server.key " +
      `-subj '/CN=${DB_CONTAINER}' >/dev/null 2>&1 && chmod 600 /var/lib/postgresql/server.key && ` +
      "chown postgres:postgres /var/lib/postgresql/server.key /var/lib/postgresql/server.crt)",
  ]);
  for (const setting of [
    "ssl = 'on'",
    "ssl_cert_file = '/var/lib/postgresql/server.crt'",
    "ssl_key_file = '/var/lib/postgresql/server.key'",
  ]) {
    // ALTER SYSTEM cannot run inside a transaction block, so one statement per call.
    psqlSuper(`alter system set ${setting}`);
  }
  docker(["restart", DB_CONTAINER]);
  waitFor("postgres after TLS restart", () => psql(["-c", "select 1"]).status === 0);
}

function startDatabase() {
  log("recreating containers");
  docker(["rm", "-f", DB_CONTAINER, STORAGE_CONTAINER, AUTH_CONTAINER]);
  docker(["network", "create", NETWORK]);
  const created = docker([
    "run",
    "-d",
    "--name",
    DB_CONTAINER,
    "--network",
    NETWORK,
    "-p",
    `${PORT}:5432`,
    "-p",
    "5432:5432",
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
  pinContainerNameToLoopback();

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
  docker([
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
  waitFor("storage schema", () => {
    const result = psql(["-Atc", "select to_regclass('storage.buckets') is not null"]);
    return result.status === 0 && result.stdout.trim() === "t";
  });

  log("starting gotrue so it migrates the auth schema");
  docker([
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
  waitFor("auth schema", () => {
    const result = psql([
      "-Atc",
      "select count(*) from information_schema.columns where table_schema='auth' " +
        "and table_name='users' and column_name='email_confirmed_at'",
    ]);
    return result.status === 0 && result.stdout.trim() === "1";
  });
}

function applyMigrations() {
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
  const deployed = run("node", [path.join("supabase", "db", "run-deploy.js"), "local"]);
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

function up() {
  const dockerStatus = ensureDockerReady();
  if (dockerStatus !== 0) return dockerStatus;

  startDatabase();
  startSchemaOwners();
  applyMigrations();
  applyDeployAndSeed();
  enableTls();

  log("ready");
  log(`  psql / app:   ${DB_URL}`);
  log(`  pgTAP runner: --network-id ${NETWORK} --db-url ${CONTAINER_DB_URL}`);
  return 0;
}

function down() {
  docker(["rm", "-f", DB_CONTAINER, STORAGE_CONTAINER, AUTH_CONTAINER]);
  docker(["network", "rm", NETWORK]);
  log("removed");
  return 0;
}

function test(extraArgs) {
  const result = run("npx", [
    "supabase",
    "test",
    "db",
    "--network-id",
    NETWORK,
    "--db-url",
    CONTAINER_DB_URL,
    ...(extraArgs.length > 0 ? extraArgs : ["supabase/tests"]),
  ]);
  return result.status ?? 1;
}

function lint() {
  const result = run("npx", [
    "supabase",
    "db",
    "lint",
    "--db-url",
    CONTAINER_DB_URL,
    "--schema",
    "public",
    "--fail-on",
    "warning",
  ]);
  return result.status ?? 1;
}

const [command = "up", ...rest] = process.argv.slice(2);
const commands = {
  up,
  down,
  test: () => test(rest),
  lint,
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
