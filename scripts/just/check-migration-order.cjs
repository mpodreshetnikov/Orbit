#!/usr/bin/env node

/**
 * Fails when a branch adds a migration whose timestamp sorts before a migration the base branch
 * already carries.
 *
 * Production applies migrations with `--include-all` (see deploy-supabase.cjs), so an out-of-order
 * file is applied against a schema built by the *newer* migrations that already ran, while
 * `db reset` in CI only ever proves it applies from scratch in filename order. Those two orders
 * agree for every migration this gate lets through. The one that does not agree is caught here,
 * where the fix is free -- rename the file -- rather than in production, where it is not.
 *
 * Usage:
 *   node check-migration-order.cjs [--base <git-ref>]
 *
 * The base defaults to origin/main. CI passes the pull request's real base through
 * MIGRATION_ORDER_BASE, so a branch targeting something other than main is measured against the
 * branch it will actually merge into. A base that is asked for and cannot be resolved is an error,
 * not a skip: a gate that reports "skipped" and exits 0 is the one failure mode that would let the
 * order it exists to check go unchecked while CI stays green.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = "supabase/migrations";
const ALLOWLIST_PATH = path.join(REPO_ROOT, MIGRATIONS_DIR, ".out-of-order-allowlist");
const MIGRATION_FILE = /^(\d{14})_.+\.sql$/;
const BASE_REF_CANDIDATES = ["origin/main", "main"];

/** @param {string[]} argv @returns {{ base?: string }} */
function parseArgs(argv) {
  const index = argv.indexOf("--base");
  if (index === -1) {
    return {};
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Missing value for argument --base");
  }
  return { base: value };
}

/** @param {string | undefined} fileName @returns {string | null} */
function versionOf(fileName) {
  const match = MIGRATION_FILE.exec((fileName || "").trim());
  return match ? match[1] : null;
}

function migrationsOnly(fileNames) {
  return fileNames.filter((fileName) => versionOf(fileName));
}

/**
 * Each entry is a version and the rationale that justifies it. The rationale is required: the
 * policy this file enforces asks for a reason an exempted migration is safe against the newer
 * schema, and a rationale nothing checks for is a rationale that stops being written.
 *
 * @param {string | undefined} contents
 * @returns {{ version: string, rationale: string }[]}
 */
function parseAllowlist(contents) {
  return (contents || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^(\d{14})\s*#\s*(\S.*)$/.exec(line);
      if (!match) {
        throw new Error(
          `Malformed allowlist entry: '${line}'. Each entry must be a 14-digit version followed ` +
            "by '# ' and a rationale for why applying it against the newer schema is safe, e.g. " +
            "'20260807120000 # catalogue rows only; disjoint from every later migration'.",
        );
      }
      return { version: match[1], rationale: match[2].trim() };
    });
}

/**
 * Pure core: which of head's new migrations would be applied out of order against base.
 *
 * Additions are identified by filename rather than version, because a new file may reuse a
 * timestamp the base already carries. Such a file does not sort after the base's latest -- it ties
 * with it, and duplicate versions collide in the remote migration history besides -- so the
 * comparison is "does not sort after", not "sorts before".
 *
 * @param {{ baseFiles: string[], headFiles: string[], allowlist?: { version: string, rationale?: string }[] }} input
 */
function evaluateMigrationOrder({ baseFiles, headFiles, allowlist = [] }) {
  const baseMigrations = migrationsOnly(baseFiles);
  const baseNames = new Set(baseMigrations);
  const allowed = new Set(allowlist.map((entry) => entry.version));
  const added = migrationsOnly(headFiles).filter((fileName) => !baseNames.has(fileName));

  if (baseMigrations.length === 0) {
    return { added, latestBaseVersion: null, offenders: [], allowed: [] };
  }

  const latestBaseVersion = baseMigrations
    .map(versionOf)
    .reduce((a, b) => (String(a) > String(b) ? a : b));
  const outOfOrder = added
    .filter((fileName) => String(versionOf(fileName)) <= String(latestBaseVersion))
    .sort();

  return {
    added,
    latestBaseVersion,
    offenders: outOfOrder.filter((fileName) => !allowed.has(String(versionOf(fileName)))),
    allowed: outOfOrder.filter((fileName) => allowed.has(String(versionOf(fileName)))),
  };
}

function runGit(args) {
  return spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

function refExists(ref) {
  return runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0;
}

function resolveExplicitBaseRef(explicitBase) {
  if (refExists(explicitBase)) {
    return explicitBase;
  }

  // A shallow or partial clone can be missing a commit that genuinely exists upstream, so fetch
  // once before treating the ref as wrong. Deliberately not --depth=1: that writes .git/shallow on
  // an otherwise complete clone, and later steps in the same job read history.
  runGit(["fetch", "origin", explicitBase]);
  if (refExists(explicitBase)) {
    return explicitBase;
  }

  throw new Error(
    `Cannot resolve base ref '${explicitBase}'. It was requested explicitly, so the migration ` +
      "order cannot be checked and this is a failure rather than a skip. Pass a ref that exists " +
      "in this checkout, or omit it to fall back to " +
      `${BASE_REF_CANDIDATES.join(" then ")}.`,
  );
}

function resolveDefaultBaseRef() {
  return BASE_REF_CANDIDATES.find((candidate) => refExists(candidate)) ?? null;
}

function readBaseMigrations(baseRef) {
  const result = runGit(["ls-tree", "-r", "--name-only", baseRef, "--", `${MIGRATIONS_DIR}/`]);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => path.posix.basename(line.trim()))
    .filter(Boolean);
}

function readHeadMigrations() {
  return fs.readdirSync(path.join(REPO_ROOT, MIGRATIONS_DIR));
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return [];
  }
  return parseAllowlist(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
}

function formatFailure({ offenders, latestBaseVersion, baseRef }) {
  return [
    `Migration(s) added out of order relative to ${baseRef}:`,
    ...offenders.map((fileName) => `  ${fileName} does not sort after ${latestBaseVersion}`),
    "",
    `${baseRef} already carries ${latestBaseVersion}, so production has applied it. A migration`,
    "that does not sort after it is applied against a schema those later migrations already",
    "changed, which is an order `db reset` never exercises. A migration reusing that exact",
    "timestamp collides in the remote migration history besides.",
    "",
    "Rename the file to a timestamp after the latest one on the base branch (its contents are",
    "unchanged; only the ordering is). If applying it out of order is genuinely intended and",
    `reviewed, add a line to ${MIGRATIONS_DIR}/.out-of-order-allowlist of the form`,
    "'<version> # why it is safe against the newer schema'.",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const requestedBase = args.base || (process.env.MIGRATION_ORDER_BASE || "").trim();
  const baseRef = requestedBase ? resolveExplicitBaseRef(requestedBase) : resolveDefaultBaseRef();

  if (!baseRef) {
    console.log(
      `Migration order check skipped: no base ref to compare against (tried ${BASE_REF_CANDIDATES.join(", ")}).`,
    );
    return 0;
  }

  const baseFiles = readBaseMigrations(baseRef);
  if (baseFiles === null) {
    throw new Error(`Could not read ${MIGRATIONS_DIR} at ${baseRef}.`);
  }

  const result = evaluateMigrationOrder({
    baseFiles,
    headFiles: readHeadMigrations(),
    allowlist: readAllowlist(),
  });

  for (const fileName of result.allowed) {
    console.log(`Migration ${fileName} is out of order but allowlisted; not failing.`);
  }

  if (result.offenders.length > 0) {
    console.error(formatFailure({ ...result, baseRef }));
    return 1;
  }

  console.log(
    result.added.length > 0
      ? `Migration order OK: ${result.added.length} added migration(s) checked against ${result.latestBaseVersion} (${baseRef}).`
      : `Migration order OK: no migrations added against ${baseRef}.`,
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { evaluateMigrationOrder, parseAllowlist, parseArgs, versionOf };
