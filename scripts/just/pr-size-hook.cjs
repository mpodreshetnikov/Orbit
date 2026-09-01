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
 * The state is keyed by branch and base, and a different key starts again from nothing. Without the
 * key, a branch that once reached a high bucket would silence the warning for every branch checked
 * out after it -- suppressing exactly the early warning this exists to give.
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
  resolveConfiguredBaseRef,
  resolveDefaultBaseRef,
} = require("./check-pr-size.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATE_PATH = path.join(REPO_ROOT, ".git", "pr-size-hook-state");
const REPORT_STEP = 100;

/**
 * @param {number} addedLines
 * @param {string} key identity of what was measured: the branch and the base it was measured against
 * @param {string} [statePath]
 * @returns {boolean}
 */
function shouldReport(addedLines, key, statePath = STATE_PATH) {
  const bucket = Math.floor(addedLines / REPORT_STEP);
  let previous = -1;
  try {
    // Split on the last tab, not the first: the key is composed of fields and carries its own.
    const stored = fs.readFileSync(statePath, "utf8").trim();
    const separator = stored.lastIndexOf("\t");
    previous = stored.slice(0, separator) === key ? Number(stored.slice(separator + 1)) : -1;
  } catch {
    previous = -1;
  }
  if (Number.isFinite(previous) && bucket <= previous) {
    return false;
  }
  try {
    fs.writeFileSync(statePath, `${key}\t${bucket}`);
  } catch {
    // A read-only .git is not a reason to withhold the warning; it only costs a repeat.
  }
  return true;
}

function main() {
  const branch = resolveBranch(undefined);
  // Same order as the gate, so the hook and the check never measure against different bases.
  const baseRef = resolveConfiguredBaseRef(branch) || resolveDefaultBaseRef();
  if (!baseRef) {
    return;
  }

  const result = evaluateChangeSize({
    numstat: readNumstat(baseRef),
    allowlist: readAllowlist(),
    branch,
  });

  if (result.branchExemption || (!result.overLimit && !result.nearLimit)) {
    return;
  }
  if (!shouldReport(result.addedLines, `${branch ?? "HEAD"}\t${baseRef}`)) {
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
