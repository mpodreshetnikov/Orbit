#!/usr/bin/env node

/**
 * Fails when the tree carries a migration whose timestamp does not sort after the migrations that
 * reached the base branch before it.
 *
 * Production applies migrations with `--include-all` (see deploy-supabase.cjs), so an out-of-order
 * file is applied against a schema built by the *newer* migrations that already ran, while
 * `db reset` in CI only ever proves it applies from scratch in filename order. Those two orders
 * agree for every migration this gate lets through. The one that does not agree is caught here,
 * where the fix is usually free -- rename the file -- rather than in production, where it is not.
 *
 * The check answers for the whole tree, not only for what the branch adds. A misordered file that
 * is already on the base branch is not an addition, so an added-only check goes quiet on it after
 * one push -- which is how 20260901150000 reached production on 2026-09-02 (T-260902-1ui). The
 * ordering verdict therefore comes from the order migrations *landed*, read out of first-parent
 * history, and every file still in the tree answers for its own position.
 *
 * Usage:
 *   node check-migration-order.cjs [--base <git-ref>]
 *
 * The base defaults to origin/main. CI passes the pull request's real base through
 * MIGRATION_ORDER_BASE, so a branch targeting something other than main is measured against the
 * branch it will actually merge into. A base that is asked for and cannot be resolved is an error,
 * not a skip: a gate that reports "skipped" and exits 0 is the one failure mode that would let the
 * order it exists to check go unchecked while CI stays green.
 *
 * A pull-request verdict expires the moment anything else merges: "my version sorts after
 * everything on the base" stops being true with nothing on the branch moving. Only a run against
 * the state that actually merges is evidence about it, and what guarantees that here is the `main
 * protection` ruleset requiring a branch to be up to date with `main` before it merges: the base
 * CI hands this check is then the base the branch lands on. See `.github/workflows/main.yml`.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = "supabase/migrations";
const ALLOWLIST_PATH = path.join(REPO_ROOT, MIGRATIONS_DIR, ".out-of-order-allowlist");
const MIGRATION_FILE = /^(\d{14})_.+\.sql$/;
const BASE_REF_CANDIDATES = ["origin/main", "main"];
// A push event reports this as the previous commit when a branch has no previous commit. It means
// "no baseline", not "a ref that failed to resolve", so it takes the fallback rather than the error.
const ZERO_SHA = "0000000000000000000000000000000000000000";
// Marks a commit line in the `git log` output the landing order is read from. A migration filename
// can never begin with it, so the two cannot be confused.
const LANDING_COMMIT_PREFIX = "commit ";

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
 * Each entry is a migration *filename*, a digest of its contents, and the rationale that justifies
 * it.
 *
 * The rationale is required: the policy this file enforces asks for a reason an exempted migration
 * is safe against the newer schema, and a rationale nothing checks for is a rationale that stops
 * being written.
 *
 * The digest is required for the same reason the filename is. An exemption keyed by version alone
 * would be inherited by a *replacement* -- a branch deleting the recorded file and adding different
 * SQL under the same version -- and one keyed by filename alone would still be inherited by an
 * edit in place. Either way production skips the new SQL entirely, the version already being in
 * schema_migrations, and no duplicate is left for the count to see. An exemption is a judgement
 * about particular SQL against a particular schema, so it names the file *and* pins its contents:
 * change either, and the exemption stops applying and the ordering question is asked again.
 *
 * @param {string | undefined} contents
 * @returns {{ file: string, version: string, digest: string, rationale: string }[]}
 */
function parseAllowlist(contents) {
  return (contents || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^(\S+\.sql)\s+([0-9a-f]{16,64})\s*#\s*(\S.*)$/.exec(line);
      const version = match ? versionOf(match[1]) : null;
      if (!match || !version) {
        throw new Error(
          `Malformed allowlist entry: '${line}'. Each entry must be a migration filename -- not ` +
            "the bare version, which would also exempt a different file that reuses it -- then at " +
            "least 16 hex characters of the file's sha256, then '# ' and a rationale for why " +
            "applying it against the newer schema is safe, e.g. '20260807120000_catalogue.sql " +
            "3f7a1c9d40b28e55 # catalogue rows only; disjoint from every later migration'. Read a " +
            `file's digest with \`shasum -a 256 ${MIGRATIONS_DIR}/<file>\`.`,
        );
      }
      return { file: match[1], version, digest: match[2], rationale: match[3].trim() };
    });
}

/** @param {string} contents @returns {string} */
function digestOf(contents) {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

/**
 * An exemption applies only while the file it was written about is the file in the tree.
 *
 * @param {{ file: string, digest: string }} entry
 * @param {Record<string, string>} digests full sha256 of each migration in the tree, by filename
 */
function exemptionApplies(entry, digests) {
  const actual = digests[entry.file];
  return typeof actual === "string" && actual.startsWith(entry.digest);
}

/**
 * Reads the order migrations landed from `git log --first-parent --diff-filter=A --name-only`.
 *
 * Each commit is one batch. Migrations that arrive together in a single commit -- a merge bringing
 * in a whole branch, most often -- are not out of order with respect to each other: they are
 * applied in filename order, and that is exactly the order `db reset` proves. Only a migration that
 * lands after a *later* version was already on the branch is applied against a schema it never met
 * in CI.
 *
 * That batching is also what keeps a shallow clone honest. Every migration older than the clone's
 * boundary appears added in the boundary commit, so they form one batch and none of them is
 * reported. The check then sees less than it would with full history, but it never invents a
 * violation that full history would not show.
 *
 * @param {string | undefined} output
 * @returns {string[][]} one array of migration filenames per commit, oldest commit first
 */
function parseLandingOrder(output) {
  const batches = [];
  let current = null;
  for (const line of (output || "").split(/\r?\n/)) {
    if (line.startsWith(LANDING_COMMIT_PREFIX)) {
      current = [];
      batches.push(current);
      continue;
    }
    const fileName = path.posix.basename(line.trim());
    if (!fileName || !current || !versionOf(fileName)) {
      continue;
    }
    current.push(fileName);
  }
  return batches.filter((batch) => batch.length > 0);
}

/**
 * Which files in the tree land after a version later than their own was already there.
 *
 * `pending` is what this change contributes -- the migrations the base branch does not have. They
 * are held out of the historical batches even when history already shows them landing, and form the
 * final batch together, which is where merging puts them. Without that, a branch that committed a
 * newer migration and then an older one would fail locally while its own merge commit -- which
 * brings both in at once, to be applied in filename order -- passes, and a verdict that disagrees
 * with itself is worse than either answer.
 *
 * @param {{ headFiles: string[], landingOrder: string[][], pending?: string[] }} input
 * @returns {{ file: string, landsAfter: string }[]}
 */
function misorderedInTree({ headFiles, landingOrder, pending = [] }) {
  const present = new Set(migrationsOnly(headFiles));
  const landed = new Set(landingOrder.flat());
  const contributed = new Set([
    ...migrationsOnly(pending),
    ...[...present].filter((fileName) => !landed.has(fileName)),
  ]);
  const batches = [
    ...landingOrder.map((batch) =>
      batch.filter((fileName) => present.has(fileName) && !contributed.has(fileName)),
    ),
    [...contributed].filter((fileName) => present.has(fileName)).sort(),
  ];

  const misordered = [];
  let highest = null;
  for (const batch of batches) {
    for (const fileName of batch) {
      const version = String(versionOf(fileName));
      if (highest !== null && version <= highest) {
        misordered.push({ file: fileName, landsAfter: highest });
      }
    }
    for (const fileName of batch) {
      const version = String(versionOf(fileName));
      if (highest === null || version > highest) {
        highest = version;
      }
    }
  }
  return misordered;
}

/**
 * Pure core: what production could not apply as written.
 *
 * Three distinct faults, because they are answered differently.
 *
 * A duplicate version is never applicable. The remote migration history is keyed by version, so a
 * second file carrying one already there -- whether the twin is on the base branch or added beside
 * it in the same change -- cannot be recorded as its own migration, and its SQL silently never
 * runs. No rationale changes that, so the allowlist does not reach these.
 *
 * Being out of order is a question of what schema the file meets, which a reviewer can answer.
 * Those the allowlist can exempt. They are split by who can still act on them: `offenders` are
 * added by this change, where a rename is normally free, and `standing` are already on the base
 * branch, where a rename is only safe if nothing has applied the version yet.
 *
 * Additions are identified by filename rather than version, because a new file may reuse a
 * timestamp the base already carries.
 *
 * @param {{
 *   baseFiles: string[],
 *   headFiles: string[],
 *   allowlist?: { file: string, digest?: string, rationale?: string }[],
 *   digests?: Record<string, string>,
 *   landingOrder?: string[][] | null,
 * }} input
 */
function evaluateMigrationOrder({
  baseFiles,
  headFiles,
  allowlist = [],
  digests = {},
  landingOrder = null,
}) {
  const baseMigrations = migrationsOnly(baseFiles);
  const headMigrations = migrationsOnly(headFiles);
  const baseNames = new Set(baseMigrations);
  // An entry whose digest no longer matches the file is not an exemption but a record of one that
  // has expired, and it is reported as such rather than silently ignored: it means the SQL changed
  // under a version production has already applied and will therefore skip.
  const live = allowlist.filter((entry) => !entry.digest || exemptionApplies(entry, digests));
  const stale = allowlist
    .filter((entry) => entry.digest && !exemptionApplies(entry, digests))
    .filter((entry) => typeof digests[entry.file] === "string")
    .map((entry) => ({ file: entry.file, recorded: entry.digest, actual: digests[entry.file] }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const allowed = new Set(live.map((entry) => entry.file));
  const added = headMigrations.filter((fileName) => !baseNames.has(fileName));

  const occurrences = new Map();
  for (const fileName of headMigrations) {
    const version = String(versionOf(fileName));
    occurrences.set(version, (occurrences.get(version) ?? 0) + 1);
  }
  // Only additions are reported: a duplicate already present on the base branch is not this
  // change's to answer for, and flagging it would block every unrelated pull request.
  const duplicates = added
    .filter((fileName) => (occurrences.get(String(versionOf(fileName))) ?? 0) > 1)
    .sort();
  const duplicateNames = new Set(duplicates);

  const latestBaseVersion =
    baseMigrations.length === 0
      ? null
      : baseMigrations.map(versionOf).reduce((a, b) => (String(a) > String(b) ? a : b));

  // Without a landing order the only judgeable question is the one the base's latest version
  // answers, and it only reaches additions. With one, every file in the tree answers for itself,
  // which is what stops a misordered file already on the base from passing untouched.
  const outOfOrder =
    landingOrder === null
      ? (latestBaseVersion === null
          ? []
          : added.filter((fileName) => String(versionOf(fileName)) <= String(latestBaseVersion))
        ).map((fileName) => ({ file: fileName, landsAfter: String(latestBaseVersion) }))
      : misorderedInTree({ headFiles, landingOrder, pending: added });

  const judged = outOfOrder
    .filter((entry) => !duplicateNames.has(entry.file))
    .sort((a, b) => a.file.localeCompare(b.file));
  const addedNames = new Set(added);
  const unallowed = judged.filter((entry) => !allowed.has(entry.file));

  return {
    added,
    latestBaseVersion,
    duplicates,
    staleExemptions: stale,
    treeChecked: landingOrder !== null,
    offenders: unallowed.filter((entry) => addedNames.has(entry.file)),
    standing: unallowed.filter((entry) => !addedNames.has(entry.file)),
    allowed: judged.filter((entry) => allowed.has(entry.file)).map((entry) => entry.file),
  };
}

function runGit(args) {
  return spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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

/** @param {string[]} fileNames @returns {Record<string, string>} */
function readDigests(fileNames) {
  /** @type {Record<string, string>} */
  const digests = {};
  for (const fileName of fileNames) {
    if (!versionOf(fileName)) {
      continue;
    }
    digests[fileName] = digestOf(
      fs.readFileSync(path.join(REPO_ROOT, MIGRATIONS_DIR, fileName), "utf8"),
    );
  }
  return digests;
}

/**
 * `--first-parent` is what makes this the order migrations reached the branch rather than the order
 * they were written: a migration authored on a branch lands when the branch merges, and the merge
 * commit is where first-parent history reports it added.
 *
 * @returns {string[][] | null} null when history cannot be read at all
 */
function readLandingOrder() {
  const result = runGit([
    "log",
    "--first-parent",
    "--reverse",
    "--diff-filter=A",
    // Renames are the point, not noise: the remedy this gate recommends is to rename a migration to
    // a later timestamp, and under rename detection that lands as an `R` rather than an `A`, so the
    // new name would never appear to have landed at all and would be judged as if it were arriving
    // today. Without detection the same commit reads as an add of the new name and a delete of the
    // old, which is what actually happened to the ordering.
    "--no-renames",
    "--name-only",
    `--format=${LANDING_COMMIT_PREFIX}%H`,
    "HEAD",
    "--",
    `${MIGRATIONS_DIR}/`,
  ]);
  if (result.status !== 0) {
    return null;
  }
  return parseLandingOrder(result.stdout);
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return [];
  }
  return parseAllowlist(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
}

function renameSafetyNotice(versions) {
  const quoted = versions.map((version) => `\`${version}\``).join(", ");
  return [
    "A rename is only safe while nothing has applied the version. Once it is recorded in",
    "`supabase_migrations.schema_migrations` the version is permanent, and renaming presents the",
    "same change as unapplied, so production runs it a second time under the new key. Which case",
    "this is, is a question for the deployed database rather than for this checkout:",
    "",
    "  supabase migration list --linked",
    "",
    `Look for ${quoted} in the Remote column. A version already there cannot be renamed: record`,
    `the file in ${MIGRATIONS_DIR}/.out-of-order-allowlist instead, with the reason applying it`,
    "against the schema the later migrations had already built was safe.",
  ];
}

function formatFailure({
  duplicates,
  offenders,
  standing,
  staleExemptions,
  latestBaseVersion,
  baseRef,
}) {
  const lines = [];

  if (staleExemptions.length > 0) {
    lines.push(
      "Allowlisted migration(s) whose contents no longer match the exemption written about them:",
      ...staleExemptions.map(
        (entry) => `  ${entry.file} recorded ${entry.recorded}, now ${entry.actual.slice(0, 16)}`,
      ),
      "",
      "An exemption is a judgement about particular SQL against a particular schema, so it stops",
      "applying when the SQL changes. This is the more serious half: an allowlisted migration is",
      "one production has already applied, so editing it in place changes nothing there --",
      "`db push --include-all` skips the version, and the new SQL never runs anywhere but a local",
      "`db reset`. Put the change in a new migration. If the edit is genuinely cosmetic, update the",
      "digest in the entry and say in the rationale what changed and why it is not schema.",
    );
  }

  if (duplicates.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(
      "Migration(s) added under a timestamp another migration already uses:",
      ...duplicates.map((fileName) => `  ${fileName}`),
      "",
      "The remote migration history is keyed by that timestamp, so a second file carrying it",
      "cannot be recorded as its own migration and its SQL silently never runs. The allowlist does",
      "not cover this: no rationale makes a duplicate version applicable. Give the file a",
      "timestamp nothing else uses.",
    );
  }

  if (offenders.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(
      `Migration(s) added out of order relative to ${baseRef}:`,
      ...offenders.map((entry) => `  ${entry.file} does not sort after ${entry.landsAfter}`),
      "",
      `${baseRef} already carries ${latestBaseVersion}, so production has applied it. A migration`,
      "that does not sort after it is applied against a schema those later migrations already",
      "changed, which is an order `db reset` never exercises.",
      "",
      "Rename the file to a timestamp after the latest one on the base branch; its contents are",
      "unchanged, only the ordering.",
      "",
      ...renameSafetyNotice(offenders.map((entry) => String(versionOf(entry.file)))),
    );
  }

  if (standing.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(
      "Migration(s) already in the tree that landed out of order and are neither renamed nor",
      "recorded:",
      ...standing.map((entry) => `  ${entry.file} landed after ${entry.landsAfter}`),
      "",
      "This is not about what your branch adds. The check answers for the whole tree, so a",
      "misordered file stays failing until it is dealt with rather than going quiet on the next",
      "push -- which is exactly how one of these reached production on 2026-09-02.",
      "",
      ...renameSafetyNotice(standing.map((entry) => String(versionOf(entry.file)))),
    );
  }

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envBase = (process.env.MIGRATION_ORDER_BASE || "").trim();
  const requestedBase = args.base || (envBase === ZERO_SHA ? "" : envBase);
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

  const headFiles = readHeadMigrations();
  const result = evaluateMigrationOrder({
    baseFiles,
    headFiles,
    allowlist: readAllowlist(),
    digests: readDigests(headFiles),
    landingOrder: readLandingOrder(),
  });

  if (!result.treeChecked) {
    console.log(
      "Migration landing order could not be read from git history; only the migrations this " +
        "change adds were checked.",
    );
  }

  for (const fileName of result.allowed) {
    console.log(`Migration ${fileName} is out of order but allowlisted; not failing.`);
  }

  if (
    result.duplicates.length > 0 ||
    result.offenders.length > 0 ||
    result.standing.length > 0 ||
    result.staleExemptions.length > 0
  ) {
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

module.exports = {
  ZERO_SHA,
  digestOf,
  evaluateMigrationOrder,
  readHeadMigrations,
  readLandingOrder,
  misorderedInTree,
  parseAllowlist,
  parseArgs,
  parseLandingOrder,
  versionOf,
};
