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

function toVersions(fileNames) {
  return fileNames.map(versionOf).filter(Boolean);
}

/** @param {string | undefined} contents @returns {string[]} */
function parseAllowlist(contents) {
  return (contents || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/**
 * Pure core: which of head's new migrations would be applied out of order against base.
 *
 * @param {{ baseVersions: string[], headVersions: string[], allowlist?: string[] }} input
 */
function evaluateMigrationOrder({ baseVersions, headVersions, allowlist = [] }) {
  const base = new Set(baseVersions);
  const allowed = new Set(allowlist);
  const added = headVersions.filter((version) => !base.has(version));

  if (base.size === 0) {
    return { added, latestBaseVersion: null, offenders: [], allowed: [] };
  }

  const latestBaseVersion = baseVersions.reduce((a, b) => (a > b ? a : b));
  const outOfOrder = added.filter((version) => version < latestBaseVersion);

  return {
    added,
    latestBaseVersion,
    offenders: outOfOrder.filter((version) => !allowed.has(version)).sort(),
    allowed: outOfOrder.filter((version) => allowed.has(version)).sort(),
  };
}

function runGit(args) {
  return spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

function resolveBaseRef(explicitBase) {
  if (explicitBase) {
    const result = runGit(["rev-parse", "--verify", "--quiet", `${explicitBase}^{commit}`]);
    return result.status === 0 ? explicitBase : null;
  }

  for (const candidate of BASE_REF_CANDIDATES) {
    const result = runGit(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
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
    ...offenders.map((version) => `  ${version} sorts before ${latestBaseVersion}`),
    "",
    `${baseRef} already carries ${latestBaseVersion}, so production has applied it. A migration`,
    "added below it is applied against a schema those later migrations already changed, which is",
    "an order `db reset` never exercises.",
    "",
    "Rename the file to a timestamp after the latest one on the base branch (its contents are",
    "unchanged; only the ordering is). If applying it out of order is genuinely intended and",
    `reviewed, add its version to ${MIGRATIONS_DIR}/.out-of-order-allowlist with a comment saying`,
    "why it is safe against the newer schema.",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseRef = resolveBaseRef(args.base);

  if (!baseRef) {
    console.log(
      `Migration order check skipped: no base ref to compare against (tried ${args.base ? args.base : BASE_REF_CANDIDATES.join(", ")}).`,
    );
    return 0;
  }

  const baseFiles = readBaseMigrations(baseRef);
  if (baseFiles === null) {
    console.log(`Migration order check skipped: could not read ${MIGRATIONS_DIR} at ${baseRef}.`);
    return 0;
  }

  const result = evaluateMigrationOrder({
    baseVersions: toVersions(baseFiles),
    headVersions: toVersions(readHeadMigrations()),
    allowlist: readAllowlist(),
  });

  for (const version of result.allowed) {
    console.log(`Migration ${version} is out of order but allowlisted; not failing.`);
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
