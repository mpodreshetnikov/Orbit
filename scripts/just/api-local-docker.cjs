#!/usr/bin/env node
/**
 * Brings up the API layer `db-local-docker.cjs` deliberately leaves out, for hosts the
 * Supabase CLI cannot serve.
 *
 * `supabase start` seeds Realtime on first boot and that seeding opens an IPv6 listener, so a
 * kernel booted with `ipv6.disable=1` — every agent container — fails it with `:eafnosupport`
 * and the CLI tears the whole stack down. `db-local-docker.cjs` worked around that for the
 * database, and said in its own header what it was not doing: "What it deliberately does not
 * provide is the API layer — PostgREST, Kong, the edge runtime — so it serves the SQL checks,
 * not end-to-end tests." That gap is why nine of T-0029's acceptance scenarios were still
 * manual: not because they need a bank, but because nothing here could answer an HTTP request.
 *
 * This is that half. Three services on top of the database the other script already starts:
 *
 *   PostgREST   the REST surface `@supabase/supabase-js` talks to
 *   GoTrue      the auth surface, already migrated by `db-local-docker.cjs`
 *   functions   every `supabase/functions/<name>` served by Deno, see scripts/local-api
 *
 * and one gateway in front of them, because a Supabase client is given a single URL and routes
 * by path. Kong does that on the platform; forty lines of Node do it here (scripts/local-api).
 *
 *   node scripts/just/api-local-docker.cjs up | down | env | status
 *
 * `env` prints the same `KEY="value"` lines as `supabase status -o env`, so the e2e runner can
 * consume this lane exactly the way it consumes the CLI's.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ensureDockerReady } = require("./docker-preflight.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");

const DB_CONTAINER = process.env.ORBIT_DB_CONTAINER ?? "orbit_db";
const REST_CONTAINER = `${DB_CONTAINER}_rest`;
const AUTH_CONTAINER = `${DB_CONTAINER}_gotrue`;

const DB_PORT = Number(process.env.ORBIT_DB_PORT ?? 54322);
const GATEWAY_PORT = Number(process.env.ORBIT_GATEWAY_PORT ?? 54321);
const REST_PORT = Number(process.env.ORBIT_REST_PORT ?? 54324);
const AUTH_PORT = Number(process.env.ORBIT_AUTH_PORT ?? 54325);
const FUNCTIONS_PORT = Number(process.env.ORBIT_FUNCTIONS_PORT ?? 54326);

const IMAGE_REGISTRY = process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY ?? "public.ecr.aws";
const REST_IMAGE = process.env.ORBIT_REST_IMAGE ?? `${IMAGE_REGISTRY}/supabase/postgrest:v14.1`;
const AUTH_IMAGE = process.env.ORBIT_AUTH_IMAGE ?? `${IMAGE_REGISTRY}/supabase/gotrue:v2.186.0`;

/**
 * The same secret `db-local-docker.cjs` uses, and the same one the CLI's local stack ships.
 * It is a local-only fixture: it signs tokens for a database that exists on this machine for
 * the length of a test run, and it is in the CLI's own published defaults.
 */
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

const PID_FILE = path.join(repoRoot, "node_modules", ".cache", "orbit-local-api.json");

function log(message) {
  console.log(`[api-local-docker] ${message}`);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function docker(args, options = {}) {
  return run("docker", args, options);
}

function dockerOrThrow(args, what) {
  const result = docker(args);
  if (result.status !== 0) {
    throw new Error(`${what} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
}

/**
 * Signed here rather than hard-coded, so the keys always match whatever `JWT_SECRET` is. The
 * published local keys are the same two claims signed with the same secret; pasting them in
 * would work until someone changed the secret and then fail as an ordinary 401.
 */
function signKey(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "supabase-demo",
    role,
    iat: issuedAt,
    exp: issuedAt + 60 * 60 * 24 * 365,
  });
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function keys() {
  return { anonKey: signKey("anon"), serviceRoleKey: signKey("service_role") };
}

function isRunning(container) {
  const result = docker(["inspect", "-f", "{{.State.Running}}", container]);
  return result.status === 0 && result.stdout.trim() === "true";
}

function waitForHttp(label, url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = run("curl", ["-s", "-m", "3", "-o", "/dev/null", "-w", "%{http_code}", url]);
    if (probe.status === 0 && /^[1-5]\d\d$/.test(probe.stdout.trim())) return;
    sleepSync(500);
  }
  throw new Error(`${label} did not answer on ${url} within ${Math.round(timeoutMs / 1000)}s`);
}

/** Node has no sleep, and this script is a sequence of waits. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function resolveDeno() {
  const configured = process.env.ORBIT_DENO_BIN;
  if (configured) return configured;
  const onPath = run("sh", ["-c", "command -v deno"]);
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim();
  const home = process.env.HOME ?? "";
  const installed = path.join(home, ".deno", "bin", "deno");
  if (home && fs.existsSync(installed)) return installed;
  throw new Error(
    "deno was not found. The edge functions are Deno modules and this lane serves them " +
      "directly, so install Deno (https://deno.land) or set ORBIT_DENO_BIN.",
  );
}

function startRest() {
  if (isRunning(REST_CONTAINER)) {
    log(`${REST_CONTAINER} already running`);
    return;
  }
  docker(["rm", "-f", REST_CONTAINER]);
  log(`starting postgrest on ${REST_PORT}`);
  dockerOrThrow(
    [
      "run",
      "-d",
      "--name",
      REST_CONTAINER,
      "--network",
      "host",
      "-e",
      `PGRST_DB_URI=postgresql://authenticator:postgres@127.0.0.1:${DB_PORT}/postgres`,
      "-e",
      "PGRST_DB_SCHEMAS=public,graphql_public",
      "-e",
      "PGRST_DB_ANON_ROLE=anon",
      "-e",
      `PGRST_JWT_SECRET=${JWT_SECRET}`,
      "-e",
      "PGRST_DB_USE_LEGACY_GUCS=false",
      "-e",
      `PGRST_SERVER_PORT=${REST_PORT}`,
      REST_IMAGE,
    ],
    `starting ${REST_CONTAINER}`,
  );
}

function startAuth() {
  if (isRunning(AUTH_CONTAINER)) {
    log(`${AUTH_CONTAINER} already running`);
    return;
  }
  docker(["rm", "-f", AUTH_CONTAINER]);
  log(`starting gotrue on ${AUTH_PORT}`);
  dockerOrThrow(
    [
      "run",
      "-d",
      "--name",
      AUTH_CONTAINER,
      "--network",
      "host",
      "-e",
      "GOTRUE_DB_DRIVER=postgres",
      "-e",
      `GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin:postgres@127.0.0.1:${DB_PORT}/postgres`,
      "-e",
      `GOTRUE_SITE_URL=${process.env.E2E_BASE_URL ?? "http://localhost:3100"}`,
      "-e",
      "GOTRUE_API_HOST=0.0.0.0",
      "-e",
      `PORT=${AUTH_PORT}`,
      "-e",
      `API_EXTERNAL_URL=http://127.0.0.1:${GATEWAY_PORT}/auth/v1`,
      "-e",
      `GOTRUE_JWT_SECRET=${JWT_SECRET}`,
      "-e",
      "GOTRUE_JWT_EXP=3600",
      "-e",
      "GOTRUE_JWT_AUD=authenticated",
      "-e",
      "GOTRUE_JWT_ADMIN_ROLES=service_role",
      "-e",
      // Deprecated by GoTrue and still load-bearing: it is what a new user's `role` is set to,
      // and `role` is the claim PostgREST runs `set role` on. Without it every user this lane
      // creates gets an empty role, authenticates perfectly, and is then refused by PostgREST
      // with `role "" does not exist` — which surfaces three layers up as "Access Not Granted".
      "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
      "-e",
      "GOTRUE_DISABLE_SIGNUP=false",
      // No mail server in this lane, so a sign-up that waited for confirmation would hang a
      // test on a link nobody can click.
      "-e",
      "GOTRUE_MAILER_AUTOCONFIRM=true",
      "-e",
      "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
      AUTH_IMAGE,
    ],
    `starting ${AUTH_CONTAINER}`,
  );
}

function spawnDetached(command, args, env, logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, "a");
  const child = require("child_process").spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  return child.pid;
}

function readPids() {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writePids(pids) {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, `${JSON.stringify(pids, null, 2)}\n`);
}

function startFunctions(secrets) {
  const deno = resolveDeno();
  const logPath = path.join(repoRoot, "node_modules", ".cache", "orbit-local-functions.log");
  log(`starting edge functions on ${FUNCTIONS_PORT} (${deno})`);
  const pid = spawnDetached(
    deno,
    [
      "run",
      "--allow-all",
      "--config",
      "supabase/functions/deno.json",
      "supabase/functions/_local/serve.ts",
    ],
    {
      ORBIT_FUNCTIONS_PORT: String(FUNCTIONS_PORT),
      // Every function reaches the rest of the stack through the gateway, the way it would
      // reach the platform through one origin.
      SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
      SUPABASE_ANON_KEY: secrets.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: secrets.serviceRoleKey,
      // The e2e suite requires deterministic, no-external-LLM extraction. Under the CLI that
      // is asserted by inspecting the edge-runtime container's environment; here the functions
      // inherit this process's, so it is set rather than checked.
      HEALTH_STRUCTURE_PARSER_MODE: process.env.HEALTH_STRUCTURE_PARSER_MODE ?? "e2e_stub",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "e2e-local-disabled",
    },
    logPath,
  );
  return pid;
}

function startGateway() {
  const logPath = path.join(repoRoot, "node_modules", ".cache", "orbit-local-gateway.log");
  log(`starting gateway on ${GATEWAY_PORT}`);
  return spawnDetached(
    process.execPath,
    [path.join("scripts", "local-api", "gateway.cjs")],
    {
      ORBIT_GATEWAY_PORT: String(GATEWAY_PORT),
      ORBIT_REST_PORT: String(REST_PORT),
      ORBIT_AUTH_PORT: String(AUTH_PORT),
      ORBIT_FUNCTIONS_PORT: String(FUNCTIONS_PORT),
    },
    logPath,
  );
}

/**
 * Repairs users left with an empty role.
 *
 * `role` is what PostgREST runs `set role` on, and GoTrue fills it from
 * `GOTRUE_JWT_DEFAULT_GROUP_NAME` at creation time. A user created while that was unset keeps
 * the empty role for good: it signs in, and every request it makes is refused with
 * `role "" does not exist`. Setting the variable fixes the next user and not that one, and the
 * database outlives the lane — so the invariant is made true here rather than documented.
 */
function repairEmptyUserRoles() {
  const repaired = run("docker", [
    "exec",
    DB_CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-Atc",
    "update auth.users set role = 'authenticated' " +
      "where role is null or role = '' returning email",
  ]);
  const emails = (repaired.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    // psql prints the command tag after the returned rows, and it is not an email.
    .filter((line) => line && !/^UPDATE \d+$/.test(line));
  if (emails.length > 0) {
    log(`repaired the empty role on ${emails.length} user(s): ${emails.join(", ")}`);
  }
}

function up() {
  ensureDockerReady();
  const dbUp = run(process.execPath, [path.join(__dirname, "db-local-docker.cjs"), "up"], {
    stdio: "inherit",
  });
  if (dbUp.status !== 0) throw new Error("the database did not come up");

  const secrets = keys();
  startRest();
  startAuth();
  repairEmptyUserRoles();

  const pids = readPids();
  pids.functions = startFunctions(secrets);
  pids.gateway = startGateway();
  writePids(pids);

  waitForHttp("postgrest", `http://127.0.0.1:${REST_PORT}/`);
  waitForHttp("gotrue", `http://127.0.0.1:${AUTH_PORT}/health`);
  // Deno type-checks and downloads on first boot, which is minutes rather than seconds.
  waitForHttp("edge functions", `http://127.0.0.1:${FUNCTIONS_PORT}/health`, 300000);
  waitForHttp("gateway", `http://127.0.0.1:${GATEWAY_PORT}/gateway/health`);

  log("ready");
  log(`  API_URL: http://127.0.0.1:${GATEWAY_PORT}`);
}

function stopPid(name, pid) {
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
    log(`stopped ${name} (pid ${pid})`);
  } catch {
    // Already gone. Reporting it as a failure would make `down` fail on a clean machine.
  }
}

function down() {
  const pids = readPids();
  stopPid("gateway", pids.gateway);
  stopPid("functions", pids.functions);
  writePids({});
  for (const container of [REST_CONTAINER, AUTH_CONTAINER]) {
    const removed = docker(["rm", "-f", container]);
    if (removed.status === 0) log(`removed ${container}`);
  }
}

function envLines() {
  const secrets = keys();
  return [
    `API_URL="http://127.0.0.1:${GATEWAY_PORT}"`,
    `DB_URL="postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres"`,
    `ANON_KEY="${secrets.anonKey}"`,
    `SERVICE_ROLE_KEY="${secrets.serviceRoleKey}"`,
    `JWT_SECRET="${JWT_SECRET}"`,
  ];
}

function status() {
  const pids = readPids();
  const rows = [
    ["postgrest", isRunning(REST_CONTAINER) ? "running" : "stopped"],
    ["gotrue", isRunning(AUTH_CONTAINER) ? "running" : "stopped"],
    ["functions", pids.functions ? `pid ${pids.functions}` : "stopped"],
    ["gateway", pids.gateway ? `pid ${pids.gateway}` : "stopped"],
  ];
  for (const [name, state] of rows) log(`${name.padEnd(10)} ${state}`);
}

/**
 * The round trip this lane exists for, made once against the real services.
 *
 * The unit tests cover the gateway's routing decisions and the convention the functions server
 * rests on. Neither can tell you that a user token minted by GoTrue is accepted by an edge
 * function that reached PostgREST through the gateway — that is four processes agreeing, and
 * the only way to know is to ask them.
 */
async function smoke() {
  const secrets = keys();
  const apiUrl = `http://127.0.0.1:${GATEWAY_PORT}`;

  const email = process.env.ORBIT_LOCAL_API_EMAIL ?? "dev@example.com";
  const password = process.env.ORBIT_LOCAL_API_PASSWORD ?? "orbit-local-password";

  const allowed = run("docker", [
    "exec",
    DB_CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-Atc",
    `select u.id from auth.users u join public.allowed_users a on a.email = u.email where u.email = '${email}' limit 1`,
  ]);
  const userId = (allowed.stdout || "").trim();
  if (!userId) {
    throw new Error(
      `${email} is not both an auth user and an allowed user in this database. ` +
        "Re-seed with `node scripts/just/db-local-docker.cjs up --recreate`.",
    );
  }

  // The seed creates the user but no password; this lane has no mail server, so a password is
  // the only way in. Set every time rather than once, because the database outlives the lane.
  const setPassword = await fetch(`${apiUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      apikey: secrets.serviceRoleKey,
      Authorization: `Bearer ${secrets.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!setPassword.ok) {
    throw new Error(`could not set the local password: HTTP ${setPassword.status}`);
  }

  const signIn = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: secrets.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await signIn.json();
  const accessToken = typeof session?.access_token === "string" ? session.access_token : null;
  if (!accessToken) {
    throw new Error(
      `sign-in failed: HTTP ${signIn.status} ${JSON.stringify(session).slice(0, 200)}`,
    );
  }
  // The claim PostgREST runs `set role` on. A token without it signs in, passes every auth
  // check, and is then refused by PostgREST with `role "" does not exist` — which reaches the
  // browser as "Access Not Granted" and reads like an allowlist problem. Checked here, where
  // the message can say what it actually is.
  const claims = JSON.parse(
    Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8") || "{}",
  );
  if (claims.role !== "authenticated") {
    throw new Error(
      `gotrue issued a token with role ${JSON.stringify(claims.role)} rather than ` +
        '"authenticated". GOTRUE_JWT_DEFAULT_GROUP_NAME is what sets it, and a user created ' +
        "while it was unset keeps the empty role until the row is repaired.",
    );
  }
  log("gotrue issued a user token carrying role=authenticated");

  const personId = (
    run("docker", [
      "exec",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      "select id from public.persons limit 1",
    ]).stdout || ""
  ).trim();
  if (!personId) throw new Error("no person in this database to import for");

  const context = await fetch(`${apiUrl}/functions/v1/money-import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get_import_context",
      source: "tbank",
      payer_person_id: personId,
    }),
  });
  const body = await context.json();
  if (!context.ok) {
    throw new Error(
      `money-import refused the round trip: HTTP ${context.status} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  if (typeof body?.recommended_mode !== "string") {
    throw new Error(
      `money-import answered without an import context: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  log(`money-import answered through the gateway (recommended_mode: ${body.recommended_mode})`);
  log("smoke ok");
}

const COMMANDS = { up, down, status, smoke, env: () => console.log(envLines().join("\n")) };

function main() {
  const command = process.argv[2] ?? "up";
  const action = COMMANDS[command];
  if (!action) {
    console.error(`Unknown command: ${command}. Use ${Object.keys(COMMANDS).join(" | ")}.`);
    process.exit(1);
  }
  Promise.resolve()
    .then(action)
    .catch((error) => {
      console.error(`[api-local-docker] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}

if (require.main === module) main();

module.exports = { envLines, signKey, keys, JWT_SECRET, GATEWAY_PORT };
