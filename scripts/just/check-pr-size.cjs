#!/usr/bin/env node

/**
 * Fails when a branch adds more reviewable lines against its base branch than one automated review
 * pass is worth.
 *
 * Codex reviews a pull request once, when it is opened, so the diff is what that single pass has to
 * carry. The measurement this limit rests on was taken under the previous `New commits` trigger,
 * where the same relationship showed up as rounds: 46 added lines drew none, 651 drew five, and
 * 3011 drew twenty-one over nineteen hours. A change that needed twenty-one passes to converge is
 * not one a single pass reads adequately. The answer is a different cut -- one pull request per
 * milestone, something that ships and reviews on its own -- rather than a finished branch divided
 * by line count; docs/QUALITY.md under `Reviewable Change Size` is canonical.
 *
 * "Reviewable" excludes recorded fixtures, lockfiles, generated artifacts and the generated skill
 * mirror. Nobody reads those line by line, and counting them would fail a cassette recording with a
 * limit aimed at hand-written code.
 *
 * Usage:
 *   node check-pr-size.cjs [--base <git-ref>] [--branch <name>] [--warn-at <lines>] [--advisory]
 *
 * `--advisory` never fails: it warns from the warning mark on and is otherwise silent, which is how
 * the editor and pre-commit hooks run it. The point of running it there is that the limit is met
 * while the cut can still be changed; met for the first time in CI, the work is already finished and
 * the cheapest-looking answer is to slice it into pieces that do not stand on their own.
 *
 * The base defaults to origin/main. CI passes the pull request's real base through PR_SIZE_BASE and
 * its head branch through PR_SIZE_BRANCH, so a branch targeting something other than main is
 * measured against the branch it will actually merge into. A base that is asked for and cannot be
 * resolved is an error, not a skip: a gate that reports "skipped" and exits 0 is the one failure
 * mode that lets the thing it exists to check go unchecked while CI stays green.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ALLOWLIST_PATH = path.join(REPO_ROOT, ".large-change-allowlist");
const BASE_REF_CANDIDATES = ["origin/main", "main"];
const MAX_REVIEWABLE_ADDED_LINES = 1500;

// The band below the limit where a branch is told it is running out of room. It exists because the
// limit fires at the worst possible moment -- the work is finished, so the cheapest-looking answer
// is to slice the finished branch until the pieces fit, which is the one answer the policy forbids.
// Three quarters leaves roughly a milestone's worth of room to change the cut instead.
const WARNING_FRACTION = 0.75;

// A push event reports this as the previous commit when a branch has no previous commit. It means
// "no baseline", not "a ref that failed to resolve", so it takes the fallback rather than the error.
const ZERO_SHA = "0000000000000000000000000000000000000000";

/**
 * Paths whose added lines no reviewer reads in sequence. Kept in the script rather than in the
 * allowlist because they are properties of the repository layout, not reviewed exceptions: a
 * lockfile is never hand-written here, and .claude/skills is generated from .agents/skills by
 * sync-agent-skills.cjs.
 */
const NON_REVIEWABLE = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)deno\.lock$/,
  /(^|\/)skills-lock\.json$/,
  /^\.claude\/skills\//,
  /^supabase\/db\/generated\//,
  /^src\/types\/database\.types\.ts$/,
  /(^|\/)__snapshots__\//,
];

/**
 * @param {string[]} argv
 * @returns {{ base?: string, branch?: string, warnAt?: string, advisory?: true }}
 */
function parseArgs(argv) {
  /** @type {{ base?: string, branch?: string, warnAt?: string, advisory?: true }} */
  const parsed = {};
  for (const [flag, key] of /** @type {const} */ ([
    ["base", "base"],
    ["branch", "branch"],
    ["warn-at", "warnAt"],
  ])) {
    const index = argv.indexOf(`--${flag}`);
    if (index === -1) {
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument --${flag}`);
    }
    parsed[key] = value;
  }
  // Absent rather than false, so a caller passing nothing parses to an empty object.
  if (argv.includes("--advisory")) {
    parsed.advisory = true;
  }
  return parsed;
}

/**
 * Each entry names what it exempts and why. The rationale is required: the policy this file
 * enforces asks for a reason, and a rationale nothing checks for is a rationale that stops being
 * written.
 *
 * @param {string | undefined} contents
 * @returns {{ kind: "path" | "branch", value: string, rationale: string }[]}
 */
function parseAllowlist(contents) {
  return (contents || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^(path|branch)\s+(\S+)\s*#\s*(\S.*)$/.exec(line);
      if (!match) {
        throw new Error(
          `Malformed allowlist entry: '${line}'. Each entry must be 'path <glob> # <why this ` +
            "content is not reviewable>' or 'branch <name> # <why this change cannot be split>', " +
            "e.g. 'path test/fixtures/**/cassettes/** # recorded bank responses, not hand-written'.",
        );
      }
      return {
        kind: /** @type {"path" | "branch"} */ (match[1]),
        value: match[2],
        rationale: match[3].trim(),
      };
    });
}

/**
 * Deliberately small: `*` stops at a slash, `**` crosses them. Enough for the path shapes this
 * allowlist exempts, and small enough to read at the point of failure.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  const source = glob
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`);
}

/**
 * @param {string} filePath
 * @param {{ kind: string, value: string }[]} allowlist
 * @returns {boolean}
 */
function isReviewable(filePath, allowlist) {
  if (NON_REVIEWABLE.some((pattern) => pattern.test(filePath))) {
    return false;
  }
  return !allowlist
    .filter((entry) => entry.kind === "path")
    .some((entry) => globToRegExp(entry.value).test(filePath));
}

/**
 * @param {{ numstat: string, allowlist: ReturnType<typeof parseAllowlist>, branch: string | null, limit?: number }} input
 */
/**
 * git numstat into `{ path, added }`, one entry per changed file. Shared with
 * check-review-delta.cjs so both measure a diff the same way.
 *
 * @param {string} numstat
 * @returns {{ path: string, added: number }[]}
 */
function parseNumstat(numstat) {
  /** @type {{ path: string, added: number }[]} */
  const files = [];

  for (const line of numstat.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    files.push({
      // git reports "-" for a binary file. It has no lines to read, so it is never reviewable text.
      added: match[1] === "-" ? 0 : Number(match[1]),
      // A rename is reported as "old => new" or with braces; the new path is what the reviewer
      // reads, and git keeps the unchanged prefix outside the braces.
      path: match[3].includes(" => ")
        ? match[3].replace(/\{([^{}]*) => ([^{}]*)\}/, "$2").replace(/^.* => /, "")
        : match[3],
    });
  }

  return files;
}

function evaluateChangeSize({
  numstat,
  allowlist,
  branch,
  limit = MAX_REVIEWABLE_ADDED_LINES,
  warnAt = Math.floor(MAX_REVIEWABLE_ADDED_LINES * WARNING_FRACTION),
}) {
  /** @type {{ path: string, added: number }[]} */
  const reviewable = [];
  let excludedAdded = 0;

  for (const file of parseNumstat(numstat)) {
    if (isReviewable(file.path, allowlist)) {
      reviewable.push(file);
    } else {
      excludedAdded += file.added;
    }
  }

  const addedLines = reviewable.reduce((total, file) => total + file.added, 0);
  const branchEntry =
    branch === null
      ? undefined
      : allowlist.find((entry) => entry.kind === "branch" && entry.value === branch);

  return {
    addedLines,
    excludedAdded,
    limit,
    warnAt,
    files: reviewable.length,
    largest: [...reviewable].sort((a, b) => b.added - a.added).slice(0, 5),
    overLimit: addedLines > limit,
    nearLimit: addedLines > warnAt && addedLines <= limit,
    branchExemption: branchEntry,
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
    `Cannot resolve base ref '${explicitBase}'. It was requested explicitly, so the change size ` +
      "cannot be checked and this is a failure rather than a skip. Pass a ref that exists in this " +
      `checkout, or omit it to fall back to ${BASE_REF_CANDIDATES.join(" then ")}.`,
  );
}

function resolveDefaultBaseRef() {
  return BASE_REF_CANDIDATES.find((candidate) => refExists(candidate)) ?? null;
}

/**
 * A file this branch has created but not yet committed is part of the change, and `git diff` does
 * not report it. Left out, the check would pass locally on a branch whose whole diff is new files
 * and then fail in CI once they are committed -- the reverse of what a local gate is for. Reported
 * in numstat's own shape so both sources parse through one path.
 *
 * @returns {string}
 */
function readUntrackedNumstat() {
  const listed = runGit(["ls-files", "--others", "--exclude-standard"]);
  if (listed.status !== 0) {
    return "";
  }
  return listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((filePath) => {
      let contents;
      try {
        contents = fs.readFileSync(path.join(REPO_ROOT, filePath));
      } catch {
        return null;
      }
      // git reports a binary file as "-", having no lines to read. Match that rather than counting
      // whatever newline bytes happen to fall inside it.
      if (contents.includes(0)) {
        return `-\t-\t${filePath}`;
      }
      const text = contents.toString("utf8");
      const added = text.length === 0 ? 0 : text.replace(/\n$/, "").split("\n").length;
      return `${added}\t0\t${filePath}`;
    })
    .filter(Boolean)
    .join("\n");
}

function readNumstat(baseRef) {
  const result = runGit(["diff", "--numstat", "--find-renames", baseRef]);
  if (result.status !== 0) {
    throw new Error(`Could not diff against ${baseRef}: ${(result.stderr || "").trim()}`);
  }
  return [result.stdout, readUntrackedNumstat()].filter(Boolean).join("\n");
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return [];
  }
  return parseAllowlist(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
}

function resolveBranch(explicitBranch) {
  if (explicitBranch) {
    return explicitBranch;
  }
  const envBranch = (process.env.PR_SIZE_BRANCH || "").trim();
  if (envBranch) {
    return envBranch;
  }
  // CI checks out a detached merge commit, where this reports "HEAD" and names no branch.
  const current = runGit(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  return current && current !== "HEAD" ? current : null;
}

/**
 * The largest reviewable files, as the failure and the warning both print them.
 *
 * @param {{ files: number, largest: { path: string, added: number }[], excludedAdded: number }} result
 * @returns {string[]}
 */
function formatLargest({ files, largest, excludedAdded }) {
  return [
    `${files} reviewable file(s) changed${
      excludedAdded > 0 ? `; ${excludedAdded} added line(s) excluded as not reviewable` : ""
    }. Largest:`,
    ...largest.map((file) => `  ${String(file.added).padStart(6)}  ${file.path}`),
  ];
}

/**
 * The moves this failure allows, in the order docs/QUALITY.md puts them, because this text is the
 * only part of that policy an agent reliably reads: it arrives at the moment the decision is made,
 * and the document does not. An earlier version opened with "Split the branch", which is the one
 * move the policy rules out -- a branch cut anywhere other than a milestone boundary leaves pieces
 * that cannot stand on their own, and puts the seam between them where no reviewer looks.
 */
function formatOptions() {
  return [
    "One pull request is one milestone: one thing that ships and reviews on its own. The test is",
    "whether main would still stand up if this merged and the rest of the task never did. Being over",
    "the limit means the cut is wrong, not that the branch needs dividing by line count. In order:",
    "",
    "  1. Re-cut on a milestone boundary -- two things that ship independently become two pull",
    "     requests, each named for what it delivers.",
    "  2. Stack -- ordered rather than independent work: open the second with the first as its base,",
    "     so each diff is small against its own base and merge order is review order.",
    "  3. Allowlist the branch -- one change that genuinely does not divide. Add the entry with its",
    "     reason; this is a normal outcome, not a defeat.",
    "",
    "Do not slice a finished branch into pieces that only exist to fit this number. Splitting is not",
    "free either: every pull request spends one opening review from the allowance the security",
    "review draws on.",
    "",
    "  path <glob> # why this content is not reviewable",
    "  branch <name> # why this change cannot be split",
  ];
}

function formatFailure(result, baseRef) {
  const { addedLines, limit } = result;
  return [
    `This branch adds ${addedLines} reviewable lines against ${baseRef}, over the limit of ${limit}.`,
    "",
    ...formatLargest(result),
    "",
    "A pull request is reviewed once, on open, so this whole diff gets one pass. Measured here,",
    "651 added lines took five passes to converge and 3011 took twenty-one -- a change this size",
    "is not one a single review reads adequately, and what it misses merges unseen.",
    "",
    ...formatOptions(),
  ].join("\n");
}

/**
 * Printed while the branch still fits, which is the only point at which the cut is cheap to change.
 * Past the limit the same text follows the failure, so an advisory run says what a blocking one
 * would.
 */
function formatWarning(result, baseRef) {
  const { addedLines, limit, warnAt } = result;
  const headline = result.overLimit
    ? `This branch adds ${addedLines} reviewable lines against ${baseRef}, over the limit of ${limit}. ` +
      "CI will fail on it."
    : `This branch adds ${addedLines} reviewable lines against ${baseRef}, past the ${warnAt}-line ` +
      `warning mark and ${limit - addedLines} short of the limit of ${limit}.`;

  return [`[pr-size] ${headline}`, "", ...formatLargest(result), "", ...formatOptions()].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const advisory = args.advisory === true;
  const envBase = (process.env.PR_SIZE_BASE || "").trim();
  const requestedBase = args.base || (envBase === ZERO_SHA ? "" : envBase);
  const baseRef = requestedBase ? resolveExplicitBaseRef(requestedBase) : resolveDefaultBaseRef();

  if (!baseRef) {
    // An advisory run happens on every file edit, so it says nothing when there is nothing to
    // measure against; the gate keeps reporting the skip, where it is the only trace it ran.
    if (!advisory) {
      console.log(
        `PR size check skipped: no base ref to compare against (tried ${BASE_REF_CANDIDATES.join(", ")}).`,
      );
    }
    return 0;
  }

  const warnAt = args.warnAt === undefined ? undefined : Number(args.warnAt);
  if (warnAt !== undefined && !Number.isFinite(warnAt)) {
    throw new Error(`--warn-at expects a number of lines, got '${args.warnAt}'.`);
  }

  const result = evaluateChangeSize({
    numstat: readNumstat(baseRef),
    allowlist: readAllowlist(),
    branch: resolveBranch(args.branch),
    ...(warnAt === undefined ? {} : { warnAt }),
  });

  if (result.overLimit && result.branchExemption) {
    if (!advisory) {
      console.log(
        `PR size ${result.addedLines} is over the limit of ${result.limit} but branch ` +
          `'${result.branchExemption.value}' is allowlisted; not failing. ` +
          `Reason: ${result.branchExemption.rationale}`,
      );
    }
    return 0;
  }

  // Advisory runs are hooks: they warn from the warning mark on and are otherwise silent, and they
  // never block. A commit or an edit is not the place to stop the work -- pre-push and CI are.
  if (advisory) {
    if (result.overLimit || result.nearLimit) {
      console.error(formatWarning(result, baseRef));
    }
    return 0;
  }

  if (result.overLimit) {
    console.error(formatFailure(result, baseRef));
    return 1;
  }

  if (result.nearLimit) {
    console.error(formatWarning(result, baseRef));
  }

  console.log(
    `PR size OK: ${result.addedLines} reviewable line(s) added across ${result.files} file(s) ` +
      `against ${baseRef}, limit ${result.limit}.`,
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
  MAX_REVIEWABLE_ADDED_LINES,
  WARNING_FRACTION,
  ZERO_SHA,
  evaluateChangeSize,
  formatFailure,
  formatWarning,
  globToRegExp,
  parseNumstat,
  readUntrackedNumstat,
  isReviewable,
  parseAllowlist,
  parseArgs,
  readAllowlist,
  readNumstat,
  resolveBranch,
  resolveDefaultBaseRef,
};
