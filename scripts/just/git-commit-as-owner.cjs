#!/usr/bin/env node

/**
 * Commit wrapper for Cursor Cloud (D13): sets GIT_AUTHOR_* / GIT_COMMITTER_* from the claimed
 * task owner and strips agent trailers from the message. Usage:
 *
 *   node scripts/just/git-commit-as-owner.cjs -m "subject"
 *
 * Extra args after -- are passed to `git commit`.
 */

const { spawnSync } = require("child_process");
const {
  applyRewriteEnv,
  rewriteIdentityFromClaim,
  stripAgentTrailers,
} = require("./human-authorship.cjs");

function main(argv = process.argv.slice(2)) {
  const identity = rewriteIdentityFromClaim();
  if (!identity.ok) {
    process.stderr.write(`${identity.message}\n`);
    process.exit(1);
  }
  applyRewriteEnv(identity);

  const commitArgs = ["commit", ...argv];
  // If -m is present, scrub trailers from the message argument.
  for (let i = 0; i < commitArgs.length; i++) {
    if (commitArgs[i] === "-m" && commitArgs[i + 1]) {
      commitArgs[i + 1] = stripAgentTrailers(commitArgs[i + 1]);
    }
  }

  const result = spawnSync("git", commitArgs, {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

if (require.main === module) {
  main();
}

module.exports = { main };
