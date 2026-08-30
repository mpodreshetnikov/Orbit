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
// Derived from the database's own name, not fixed. `db-data-migration-check` runs a second
// instance by setting ORBIT_DB_CONTAINER, and with fixed auxiliary names its teardown removed
// the storage and auth containers belonging to a `supabase-docker-up` stack that was already
// running — leaving that stack's Postgres up without the services that own two of its schemas,
// and no sign of why it had started failing.
const STORAGE_CONTAINER = `${DB_CONTAINER}_storage`;
const AUTH_CONTAINER = `${DB_CONTAINER}_auth`;
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

/**
 * Waits for a borrowed service to finish writing, then stops it.
 *
 * The schema waits below look for one object each, but neither service stops there: storage and
 * gotrue keep running their remaining migrations afterwards, and the containers stay up. Ours
 * then start while theirs are still going, two streams of DDL against one database — which
 * deadlocked in CI on the very first migration:
 *
 *   ERROR: deadlock detected
 *   Process 262 waits for AccessExclusiveLock on relation 16458; blocked by process 259.
 *   Process 259 waits for AccessExclusiveLock on relation 16470; blocked by process 262.
 *
 * It passes locally every time, which is the shape of a race rather than an argument that there
 * is none. The comment above says both services are borrowed for one job each; this is what
 * gives them back. Retrying the deadlock would leave the second writer there.
 */
function settleAndStop(container, role, migrationsTable) {
  // Two things have to hold together, and hold *still*: the service has applied no further
  // migration, and it is not in the middle of one. Either alone is a race — a single sample of
  // `pg_stat_activity` catches a service that happens to be idle between two migrations and
  // stops it half-done, which trades the deadlock for a partially migrated schema and no error
  // at all. Requiring the pair to be unchanged across consecutive polls is what closes the gap
  // the sample leaves; a service that pauses longer than this between migrations would have to
  // be doing nothing for six seconds mid-run.
  const stableSamplesRequired = 3;
  let previous = null;
  let stableSamples = 0;

  waitFor(`${role} to finish migrating`, () => {
    // A service that died mid-migration also has a count that stops moving and no session of its
    // own, so the two conditions below are satisfied by a crash exactly as they are by success.
    // `docker stop` then succeeds on the already-exited container and `up` carries on, reporting
    // ready over a half-migrated `storage` or `auth` schema — which only shows up later, and only
    // if our own SQL happens to touch the objects that never got created.
    const state = docker(["inspect", "-f", "{{.State.Running}}:{{.State.ExitCode}}", container]);
    if (state.status !== 0 || !state.stdout.trim().startsWith("true")) {
      throw new Error(
        `${container} stopped while migrating the ${role} schema (state ${
          state.stdout.trim() || "unknown"
        }). That schema is half-applied, so this is not a state to build on: check ` +
          `docker logs ${container}, then re-run with --recreate.`,
      );
    }

    const result = psql([
      "-Atc",
      `select coalesce((select count(*)::text from ${migrationsTable}), 'absent') || ':' || ` +
        `(select count(*) from pg_stat_activity where usename = '${role}' and state <> 'idle')`,
    ]);
    if (result.status !== 0) return false;

    const sample = result.stdout.trim();
    const [applied, busy] = sample.split(":");
    if (applied === "absent" || busy !== "0") {
      previous = sample;
      stableSamples = 0;
      return false;
    }

    stableSamples = sample === previous ? stableSamples + 1 : 0;
    previous = sample;
    return stableSamples >= stableSamplesRequired;
  });

  docker(["stop", container]);
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
    // Loopback only. This container carries the fixed password on the next line, so publishing
    // on every interface would offer a trivially-credentialed Postgres to anything that can
    // reach this host — a LAN, a shared network. `DB_URL` has always been loopback; match it.
    `127.0.0.1:${PORT}:5432`,
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
  settleAndStop(STORAGE_CONTAINER, "supabase_storage_admin", "storage.migrations");

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
  settleAndStop(AUTH_CONTAINER, "supabase_auth_admin", "auth.schema_migrations");
}

/**
 * `from` and `until` are inclusive migration version prefixes. They exist so a caller can stop
 * before a migration, put rows in the shape that migration was written to repair, and then run
 * it — which is the only way to test a data-repairing migration against anything but the empty
 * tables CI holds.
 */
function applyMigrations({ from, until, skipApplied = false } = {}) {
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

  // Only ever on a plain `up`, and never when a range was named. The repository's migrations are
  // not idempotent — `CREATE POLICY` has no `IF NOT EXISTS` — so re-running them all against a
  // database that has them fails on the second file. Skipping what
  // `supabase_migrations.schema_migrations` already records is what lets `up` reuse a container.
  //
  // Naming `--from` or `--until` is an explicit instruction to run those files, and the data
  // migration check depends on exactly that: its second pass re-applies the repair range to prove
  // the migrations are idempotent. Skipping there would make that check pass by doing nothing.
  const alreadyApplied = new Set();
  if (skipApplied) {
    const recorded = psql(["-Atc", "select version from supabase_migrations.schema_migrations"]);
    if (recorded.status === 0) {
      for (const version of recorded.stdout.split("\n")) {
        const trimmed = version.trim();
        if (trimmed) alreadyApplied.add(trimmed);
      }
    }
  }

  for (const name of files) {
    if (alreadyApplied.has(name.split("_")[0])) continue;
    // One transaction per file. `ON_ERROR_STOP=1` already stops psql at the first error, but
    // without a wrapping transaction every statement before it has committed under autocommit —
    // and the version is not recorded, so the next `up` replays the whole file: non-idempotent
    // DDL fails again on what already exists, and a data repair runs a second time over rows it
    // already changed. Either way the database cannot be brought forward without `--recreate`.
    // psql documents `--single-transaction` as wrapping the `-f` script in BEGIN/COMMIT.
    // The version insert belongs to the same transaction as the file. psql wraps every `-c` and
    // `-f` it is given in one BEGIN/COMMIT under `--single-transaction`, so the schema change and
    // the record of it commit together or not at all. Split across two invocations, an interrupt
    // in between — or a failure of the unchecked second call — left the schema changed and
    // `schema_migrations` saying the file had never run, so the next `up` replayed it and failed
    // on DDL that already existed.
    const applied = psql(
      [
        "--single-transaction",
        "-f",
        path.join(migrationsDir, name),
        "-c",
        `insert into supabase_migrations.schema_migrations (version, name) values ` +
          `('${name.split("_")[0]}', '${name}') on conflict do nothing;`,
      ],
      { stdio: "pipe" },
    );
    if (applied.status !== 0) {
      console.error(applied.stderr ?? "");
      throw new Error(`Migration failed: ${name}`);
    }
  }
  log(`applied ${files.length} migration(s)`);
}

function applyDeployAndSeed({ seed }) {
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

  // `deploy.sql` is idempotent by construction, so it runs either way. `seed.sql` is not: its
  // `persons` inserts say `ON CONFLICT DO NOTHING` with no conflict target, and `persons` has no
  // unique index those rows could ever collide on — the id is a generated uuid. So every re-run
  // adds another Max, Kate and Demi, and the seed's own dependent lookups then pick an arbitrary
  // copy. Only a database this command just built gets seeded.
  if (!seed) {
    log("reused database — skipping the seed (--recreate builds and seeds a fresh one)");
    return;
  }

  log("seeding");
  // In one transaction as well. A failure late in the file used to leave every insert before it
  // committed, and the next `up` sees a healthy database, takes the reuse path and skips seeding
  // entirely — reporting ready over a half-seeded database that only `--recreate` repairs.
  const seeded = psql(["--single-transaction", "-f", path.join(repoRoot, "supabase", "seed.sql")], {
    stdio: "pipe",
  });
  if (seeded.status !== 0) {
    console.error(seeded.stderr ?? "");
    throw new Error("seed.sql failed");
  }
}

/**
 * True when the container exists at all, whatever state it is in.
 *
 * A container that exists but is stopped — after a Docker restart, or a reboot — is not healthy,
 * and treating "not healthy" as "build a new one" force-removed it along with everything written
 * to its writable layer. That is the same destruction `--recreate` exists to ask for explicitly,
 * arriving because the daemon had been restarted.
 */
function databaseExists() {
  return docker(["inspect", "-f", "{{.State.Status}}", DB_CONTAINER]).status === 0;
}

/**
 * Starts a container that already exists, and reports whether it came back. A stopped database
 * still holds its data, its migrations and its extensions, so there is nothing to rebuild — only
 * to start and wait for.
 */
function startExistingDatabase() {
  log(`starting the stopped ${DB_CONTAINER}`);
  if (docker(["start", DB_CONTAINER]).status !== 0) return false;

  // Same check the healthy path makes, and for the same reason: a container created against a
  // different `ORBIT_DB_PORT` publishes somewhere else, so the `psql` below would be answered by
  // whatever else is listening — and `up` would then migrate that database believing it had
  // recovered this container.
  const published = docker(["port", DB_CONTAINER, "5432/tcp"]);
  if (published.status !== 0 || !published.stdout.includes(`:${PORT}`)) return false;

  try {
    waitFor("postgres", () => psql(["-c", "select 1"]).status === 0);
  } catch {
    return false;
  }
  return true;
}

/** True when the database container is up and answering, so `up` has nothing to build. */
function databaseIsHealthy() {
  const running = docker(["inspect", "-f", "{{.State.Running}}", DB_CONTAINER]);
  if (running.status !== 0 || running.stdout.trim() !== "true") return false;

  // The `psql` below goes to the host port, which is not by itself evidence about this container.
  // Change `ORBIT_DB_PORT` after the container was built and any other Postgres listening there
  // answers just as well — and `up` would then apply every migration and the deploy SQL to that
  // database while reporting that it reused `DB_CONTAINER`. Asking Docker where this container
  // actually publishes 5432 is what ties the two together. It also catches the container that is
  // running with no mapping at all, which a daemon restart can leave behind.
  const published = docker(["port", DB_CONTAINER, "5432/tcp"]);
  if (published.status !== 0 || !published.stdout.includes(`:${PORT}`)) return false;

  return psql(["-Atc", "select 1"]).status === 0;
}

function up(flags) {
  const dockerStatus = ensureDockerReady();
  if (dockerStatus !== 0) return dockerStatus;

  // `up` is not a reset, and it used to behave like one: it force-removed the container and
  // started a replacement with no volume, so re-running the documented command threw away
  // whatever a developer had accumulated — without their asking for anything destructive.
  //
  // A healthy container is reused. `--until` and `--recreate` are the two ways to ask for a
  // fresh one: the first because stopping at a chosen migration is meaningless on a database
  // already past it, which is how the data migration check uses this; the second because saying
  // so explicitly should still be possible.
  const explicitRebuild = flags.recreate || flags.until !== undefined;
  let rebuilding = explicitRebuild;

  if (!explicitRebuild) {
    if (databaseIsHealthy()) {
      log(`reusing the running ${DB_CONTAINER}; pass --recreate to rebuild it`);
    } else if (databaseExists()) {
      // It exists, so it holds data, and starting it is the only non-destructive move available.
      // When that fails the answer is to say why and stop — falling through to the rebuild would
      // force-remove the one copy of that data to fix a problem that is usually outside the
      // container (a port still held, a daemon mid-restart) and would defeat the replacement too.
      if (!startExistingDatabase()) {
        throw new Error(
          `${DB_CONTAINER} exists but did not come back up, so this stopped instead of ` +
            `replacing it — the data in it is still there. Check what is holding port ${PORT} ` +
            `and what the container says (docker logs ${DB_CONTAINER}); pass --recreate to ` +
            `discard it and build a new one.`,
        );
      }
      // The schema owners are not started again: storage and auth create their schemas once, and
      // those schemas are in the database this container just brought back.
      log(`restarted the stopped ${DB_CONTAINER}; pass --recreate to rebuild it`);
    } else {
      rebuilding = true;
    }
  }

  if (rebuilding) {
    startDatabase();
    startSchemaOwners();
  }

  applyMigrations({ until: flags.until, skipApplied: !rebuilding });
  if (!flags.noDeploy) {
    // A fresh build that fails to seed must not survive. The seed runs in one transaction, so
    // the database rolls back clean — but the container is left running and healthy, and the
    // next ordinary `up` reuses it, skips the seed by design, and reports an unseeded database
    // as ready. Nothing short of `--recreate` would ever seed it again. Removing the container
    // we just built destroys nothing that existed before this command.
    try {
      applyDeployAndSeed({ seed: rebuilding });
    } catch (error) {
      if (rebuilding) {
        log(`removing the half-built ${DB_CONTAINER} so a re-run starts clean`);
        docker(["rm", "-f", DB_CONTAINER, STORAGE_CONTAINER, AUTH_CONTAINER]);
      }
      throw error;
    }
  }

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
    // A missing plan is a failure too, not an absent constraint. `Number(undefined)` is NaN and
    // every comparison against it is false, so checking only for a mismatch lets a file that
    // emitted an `ok` and then stopped before `plan()`/`finish()` through — the shape `pg_prove`
    // reports as "No plan found in TAP output".
    // TAP treats `Bail out!` as fatal. Today the exit status alone already catches it: pgTAP's
    // `bail_out()` raises, and `ON_ERROR_STOP=1` turns that into a non-zero psql exit — checked
    // with a probe file that emits a full plan and a passing assertion before bailing, which is
    // reported `not ok` with this condition stubbed out. So this is a second, independent reason
    // rather than a repair: the TAP text is the contract, while the exit status is a side effect
    // of a psql flag set elsewhere in this file and removable without anyone connecting the two.
    const bailedOut = /^Bail out!/m.test(output);
    const planned = Number(output.match(/^1\.\.(\d+)$/m)?.[1] ?? NaN);
    const emitted = ok.length + notOk.length;
    const planMissing = !Number.isFinite(planned);
    const planMismatch = planMissing || planned !== emitted;

    const relative = path.relative(repoRoot, file);
    if (notOk.length > 0 || result.status !== 0 || ok.length === 0 || planMismatch || bailedOut) {
      failed += 1;
      console.log(`not ok - ${relative}`);
      for (const line of notOk) console.log(`    ${line}`);
      if (bailedOut) {
        console.log(`    ${output.match(/^Bail out!.*$/m)?.[0] ?? "Bail out!"}`);
      }
      if (planMissing) {
        console.log(`    no plan found in TAP output (${emitted} assertion(s) emitted)`);
      } else if (planMismatch) {
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
  recreate: rest.includes("--recreate"),
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
