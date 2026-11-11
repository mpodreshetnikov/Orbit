#!/usr/bin/env node

/**
 * Wire Cursor Cloud's per-repo git hook dispatcher to this repository's `.githooks`.
 *
 * Cursor Cloud sets `core.hooksPath` to `~/.cursor/agent-hooks/<base64(abs-root)>/` and installs a
 * `.dispatcher` that chains Cursor's own hooks with whatever `.cursor-original-hooks-path` names.
 * That path was left pointing at `.git/hooks` (samples), and the `pre-push` symlink was missing, so
 * Orbit's claim/size pre-commit and the registry's push gate never ran (T-261106-kp8).
 *
 * This installs:
 * - `pre-commit` / `pre-push` symlinks to `.dispatcher` when the dispatcher exists and the symlink
 *   is missing;
 * - `.cursor-original-hooks-path` pointing at `<repo>/.githooks` when that directory holds the
 *   named hooks.
 *
 * It never invents a Cursor agent-hooks directory: Cursor owns that layout. Call it from the
 * environment start/install script after Cursor has created the dispatcher, or by hand in a
 * session that already has one. Idempotent; exits 0 even when there is nothing to do.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO_ROOT = process.env.CURSOR_AGENT_GIT_HOOKS_REPO_ROOT
  ? path.resolve(process.env.CURSOR_AGENT_GIT_HOOKS_REPO_ROOT)
  : path.resolve(__dirname, "..", "..");

const HOOK_NAMES = ["pre-commit", "pre-push"];

/** Cursor's encoding of an absolute repo path for `~/.cursor/agent-hooks/<id>/`. */
function agentHooksId(repoRoot) {
  return Buffer.from(path.resolve(repoRoot), "utf8").toString("base64");
}

function agentHooksDir(repoRoot, home = os.homedir()) {
  return path.join(home, ".cursor", "agent-hooks", agentHooksId(repoRoot));
}

/**
 * @returns {{ ok: boolean, changed: string[], message: string }}
 */
function install({
  repoRoot = REPO_ROOT,
  home = os.homedir(),
  hooksDir = agentHooksDir(repoRoot, home),
  githooksDir = path.join(repoRoot, ".githooks"),
} = {}) {
  const changed = [];
  if (!fs.existsSync(hooksDir)) {
    return {
      ok: false,
      changed,
      message:
        `cursor-agent-git-hooks: ${hooksDir} does not exist yet (Cursor creates it). ` +
        `Nothing installed; re-run after Cursor has set core.hooksPath for this checkout.`,
    };
  }

  const dispatcher = path.join(hooksDir, ".dispatcher");
  if (!fs.existsSync(dispatcher)) {
    return {
      ok: false,
      changed,
      message: `cursor-agent-git-hooks: ${dispatcher} is missing; refusing to invent Cursor's dispatcher.`,
    };
  }

  for (const name of HOOK_NAMES) {
    const tracked = path.join(githooksDir, name);
    if (!fs.existsSync(tracked)) continue;
    const link = path.join(hooksDir, name);
    if (!fs.existsSync(link)) {
      fs.symlinkSync(".dispatcher", link);
      changed.push(`symlink ${name}`);
    }
  }

  const originalPathFile = path.join(hooksDir, ".cursor-original-hooks-path");
  const wanted = path.resolve(githooksDir);
  let previous = "";
  try {
    previous = fs.readFileSync(originalPathFile, "utf8").trim();
  } catch {
    previous = "";
  }
  if (previous !== wanted) {
    fs.writeFileSync(originalPathFile, `${wanted}\n`);
    changed.push(".cursor-original-hooks-path");
  }

  return {
    ok: true,
    changed,
    message:
      changed.length === 0
        ? `cursor-agent-git-hooks: ${hooksDir} already points at ${wanted}.`
        : `cursor-agent-git-hooks: updated ${hooksDir} (${changed.join(", ")}).`,
  };
}

/**
 * Whether Cursor's agent-hooks path for this repo will run `.githooks/pre-push` (and pre-commit when
 * present). Used by agent-env-check.
 */
function gitHooksProblem({
  repoRoot = REPO_ROOT,
  home = os.homedir(),
  hooksDir = agentHooksDir(repoRoot, home),
  githooksDir = path.join(repoRoot, ".githooks"),
} = {}) {
  if (!fs.existsSync(path.join(githooksDir, "pre-push"))) {
    return null; // This repository has no push gate to wire.
  }
  if (!fs.existsSync(hooksDir)) {
    return `${hooksDir} is missing (Cursor agent-hooks not installed for this checkout).`;
  }
  const prePush = path.join(hooksDir, "pre-push");
  if (!fs.existsSync(prePush)) {
    return `${prePush} is missing, so git never runs the push gate.`;
  }
  let original = "";
  try {
    original = fs.readFileSync(path.join(hooksDir, ".cursor-original-hooks-path"), "utf8").trim();
  } catch {
    return `${hooksDir}/.cursor-original-hooks-path is missing.`;
  }
  if (path.resolve(original) !== path.resolve(githooksDir)) {
    return (
      `${hooksDir}/.cursor-original-hooks-path is '${original}', not '${githooksDir}', ` +
      `so the tracked push gate does not run.`
    );
  }
  return null;
}

function main(argv = process.argv.slice(2)) {
  const roots = argv.length > 0 ? argv.map((p) => path.resolve(p)) : [REPO_ROOT];
  let failed = false;
  for (const root of roots) {
    const result = install({ repoRoot: root });
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    if (!result.ok) failed = true;
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  let code = 0;
  try {
    code = main();
  } catch (error) {
    process.stderr.write(
      `cursor-agent-git-hooks: ${error instanceof Error ? error.message : error}\n`,
    );
    code = 1;
  }
  process.exit(code);
}

module.exports = { HOOK_NAMES, agentHooksDir, agentHooksId, gitHooksProblem, install, main };
