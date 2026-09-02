#!/usr/bin/env node

/**
 * Reports whether the change made since the last automated review is worth asking for another one.
 *
 * Codex reviews a pull request when it is opened and not again unless asked, so everything pushed
 * after that commit is unreviewed until someone comments `@codex review`. The failure mode is no
 * longer spending twenty rounds on one branch -- it is merging code no reviewer ever read. A review
 * still costs a round from the allowance the security review draws on, so it is bought rather than
 * spent by reflex, and this reports the two things that decide it: how much unreviewed surface
 * there is, and whether any of it is the kind where a miss is expensive.
 *
 * Advisory, not a gate. It always exits 0 unless it cannot measure what it was asked to measure --
 * the decision to request a review belongs to the agent, informed by this and by the judgement
 * calls in docs/QUALITY.md that no script can make.
 *
 * Usage:
 *   node check-review-delta.cjs --since <git-ref>
 *
 * The ref is the last reviewed commit. Codex names it in the review body ("Reviewed commit") and in
 * the Commit column of its review summary comment. REVIEW_DELTA_SINCE supplies it from an
 * environment instead.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  isReviewable,
  parseAllowlist,
  parseNumstat,
  globToRegExp,
  readUntrackedNumstat,
} = require("./check-pr-size.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ALLOWLIST_PATH = path.join(REPO_ROOT, ".large-change-allowlist");

/**
 * Below this, a re-review has not paid for itself in the sample this repository has: #19's whole
 * 194-line change drew no findings at all, while #21's 651 drew eight. It is a floor on new
 * surface, not a budget -- the sensitive paths below ask for a review at any size.
 */
const REVIEWABLE_DELTA_THRESHOLD = 200;

/**
 * Surfaces where an unreviewed change is expensive enough to buy a review for at any size. Each is
 * here because a reviewer has caught something in it, or because the failure is unrecoverable once
 * merged: #18's four classes of personal data reached a recorded fixture through a scrubber the
 * repository's own leak scan had cleared.
 */
const SENSITIVE_SURFACES = [
  { glob: "supabase/migrations/**", why: "schema applied to production" },
  { glob: "supabase/db/**", why: "SQL functions, policies and triggers" },
  { glob: "supabase/functions/**", why: "edge functions serving live requests" },
  { glob: "src/app/api/oauth/**", why: "OAuth endpoints" },
  { glob: "src/app/auth/**", why: "sign-in and session handling" },
  { glob: "src/app/.well-known/**", why: "OAuth metadata clients trust" },
  { glob: ".github/workflows/**", why: "CI that deploys and holds secrets" },
  { glob: "scripts/just/secrets-preflight.cjs", why: "the secret scan itself" },
  {
    glob: "browserExtension/src/connectors/**",
    why: "scrapes upstream data and scrubs it before anything is recorded",
  },
  {
    glob: "test/fixtures/**",
    why: "recorded upstream data — #18 put thirteen phone numbers and ten personal messages in one",
  },
];

/** @param {string[]} argv @returns {{ since?: string }} */
function parseArgs(argv) {
  const index = argv.indexOf("--since");
  if (index === -1) {
    return {};
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Missing value for argument --since");
  }
  return { since: value };
}

function runGit(args) {
  return spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

function refExists(ref) {
  return runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0;
}

function resolveSince(requested) {
  if (refExists(requested)) {
    return requested;
  }
  // A shallow or partial clone can be missing a commit that genuinely exists upstream, so fetch
  // once before treating the ref as wrong.
  runGit(["fetch", "origin", requested]);
  if (refExists(requested)) {
    return requested;
  }
  throw new Error(
    `Cannot resolve --since ref '${requested}'. Pass the commit the last review read: Codex ` +
      "names it as 'Reviewed commit' in the review body and in the Commit column of its review " +
      "summary comment.",
  );
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return [];
  }
  return parseAllowlist(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
}

/**
 * @param {{ path: string, added: number }[]} files
 * @returns {{ path: string, why: string }[]}
 */
function sensitiveAmong(files) {
  /** @type {{ path: string, why: string }[]} */
  const hits = [];
  for (const file of files) {
    const surface = SENSITIVE_SURFACES.find((candidate) =>
      globToRegExp(candidate.glob).test(file.path),
    );
    if (surface) {
      hits.push({ path: file.path, why: surface.why });
    }
  }
  return hits;
}

/**
 * @param {{ numstat: string, allowlist: ReturnType<typeof parseAllowlist>, threshold?: number }} input
 */
function evaluateReviewDelta({ numstat, allowlist, threshold = REVIEWABLE_DELTA_THRESHOLD }) {
  const changed = parseNumstat(numstat);
  const reviewable = changed.filter((file) => isReviewable(file.path, allowlist));
  const addedLines = reviewable.reduce((total, file) => total + file.added, 0);

  // Deliberately over every changed file rather than the reviewable ones. A recorded fixture is
  // excluded from the line count because nobody reads it in sequence -- which is the reason it is
  // the one thing a leak reaches unseen. Filtering first would hide the #18 case entirely.
  const sensitive = sensitiveAmong(changed);

  /** @type {string[]} */
  const reasons = [];
  if (addedLines > threshold) {
    reasons.push(`${addedLines} reviewable lines added since the last review (over ${threshold})`);
  }
  for (const hit of sensitive) {
    reasons.push(`${hit.path} — ${hit.why}`);
  }

  return {
    addedLines,
    threshold,
    files: reviewable.length,
    largest: [...reviewable].sort((a, b) => b.added - a.added).slice(0, 5),
    sensitive,
    reasons,
    request: reasons.length > 0,
  };
}

function readNumstat(sinceRef) {
  const result = runGit(["diff", "--numstat", "--find-renames", sinceRef]);
  if (result.status !== 0) {
    throw new Error(`Could not diff against ${sinceRef}: ${(result.stderr || "").trim()}`);
  }
  // Same as the size gate: a file this branch created but has not committed is part of the change,
  // and `git diff` does not report it.
  return [result.stdout, readUntrackedNumstat()].filter(Boolean).join("\n");
}

function formatReport(result, sinceRef) {
  const lines = [];

  if (result.request) {
    lines.push(
      `Request a review: the change since ${sinceRef} has unreviewed surface worth reading.`,
      "",
      "Because:",
      ...result.reasons.map((reason) => `  - ${reason}`),
    );
  } else {
    lines.push(
      `No review needed: ${result.addedLines} reviewable line(s) added since ${sinceRef}, ` +
        `under the ${result.threshold} floor, and nothing sensitive was touched.`,
    );
  }

  if (result.files > 0) {
    lines.push(
      "",
      `${result.files} reviewable file(s) changed since then. Largest:`,
      ...result.largest.map((file) => `  ${String(file.added).padStart(6)}  ${file.path}`),
    );
  }

  lines.push(
    "",
    "This measures surface, not judgement. Request a review regardless of the verdict above when",
    "the fixes since the last one changed a shape other code reads -- a column, an ordering, a key,",
    "a signature. Skip it regardless when the change is only the last review's findings fixed",
    "locally, or only docs, comments, formatting or a clean base merge. docs/QUALITY.md has both",
    "lists, and the cap: at most three requested reviews beyond the one the pull request opened with.",
  );

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const requested = args.since || (process.env.REVIEW_DELTA_SINCE || "").trim();

  if (!requested) {
    throw new Error(
      "No --since ref given. Pass the commit the last review read, from Codex's 'Reviewed commit' " +
        "line or the Commit column of its review summary comment.",
    );
  }

  const sinceRef = resolveSince(requested);
  const result = evaluateReviewDelta({
    numstat: readNumstat(sinceRef),
    allowlist: readAllowlist(),
  });

  console.log(formatReport(result, sinceRef));
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
  REVIEWABLE_DELTA_THRESHOLD,
  SENSITIVE_SURFACES,
  evaluateReviewDelta,
  formatReport,
  parseArgs,
  sensitiveAmong,
};
