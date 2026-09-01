#!/usr/bin/env node

/**
 * The editor-time end of the reviewable size limit: a Claude Code `PostToolUse` hook that tells the
 * agent how much room the branch has left, while the cut can still be changed.
 *
 * It never blocks. It emits `additionalContext`, which reaches the model as information rather than
 * as a refusal, because the answer to a branch approaching the limit is to re-cut it on a milestone
 * boundary or stack it -- a decision the agent makes -- and not to stop the edit in front of it.
 *
 * Reported once per hundred lines of growth, tracked in .git/pr-size-hook-state. Repeating the same
 * warning on every file edit is how a warning stops being read.
 *
 * Any failure here is silent and exits 0. This runs on every edit; a hook that breaks the session
 * because a base ref is missing would be worse than the problem it reports.
 */

const fs = require("fs");
const path = require("path");

const {
  evaluateChangeSize,
  formatWarning,
  readAllowlist,
  readNumstat,
  resolveBranch,
  resolveDefaultBaseRef,
} = require("./check-pr-size.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATE_PATH = path.join(REPO_ROOT, ".git", "pr-size-hook-state");
const REPORT_STEP = 100;

/**
 * @param {number} addedLines
 * @param {string} [statePath]
 * @returns {boolean}
 */
function shouldReport(addedLines, statePath = STATE_PATH) {
  const bucket = Math.floor(addedLines / REPORT_STEP);
  let previous = -1;
  try {
    previous = Number(fs.readFileSync(statePath, "utf8").trim());
  } catch {
    previous = -1;
  }
  if (Number.isFinite(previous) && bucket <= previous) {
    return false;
  }
  try {
    fs.writeFileSync(statePath, String(bucket));
  } catch {
    // A read-only .git is not a reason to withhold the warning; it only costs a repeat.
  }
  return true;
}

function main() {
  const baseRef = resolveDefaultBaseRef();
  if (!baseRef) {
    return;
  }

  const result = evaluateChangeSize({
    numstat: readNumstat(baseRef),
    allowlist: readAllowlist(),
    branch: resolveBranch(undefined),
  });

  if (result.branchExemption || (!result.overLimit && !result.nearLimit)) {
    return;
  }
  if (!shouldReport(result.addedLines)) {
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: formatWarning(result, baseRef),
      },
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch {
    // Deliberately silent: see the header.
  }
}

module.exports = { REPORT_STEP, shouldReport };
