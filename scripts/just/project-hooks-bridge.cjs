#!/usr/bin/env node

/**
 * Runs this repository's Claude Code hooks in a session that did not load them.
 *
 * Claude Code reads `.claude/settings.json` from the session's working directory. A cloud session
 * holding several repositories starts above the clones and loads hooks from none of them, so in the
 * project threads that do most of the work every hook registered here -- the task-claim check, the
 * size advisory, caveman mode -- was silent (T-260902-jxe). What such a session does read is
 * `~/.claude/settings.json` inside its container, which the environment's setup script can write.
 * That file registers this bridge once per event; the bridge reads this repository's own settings
 * and runs the hooks that match, so the list of hooks stays here and the setup script never changes
 * when one is added.
 *
 * Each matching command runs with `CLAUDE_PROJECT_DIR` set to this repository and the hook input on
 * stdin, as Claude Code would run it. Their `additionalContext` is joined into one answer; a hook
 * that exits 2 -- Claude Code's "block" -- is passed through with its stderr. When the session's own
 * project directory is this repository, Claude Code already runs the hooks itself and the bridge
 * stays out of the way.
 *
 * Any failure here is silent and exits 0, like the hooks it runs.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = process.env.PROJECT_HOOKS_BRIDGE_REPO_ROOT
  ? path.resolve(process.env.PROJECT_HOOKS_BRIDGE_REPO_ROOT)
  : path.resolve(__dirname, "..", "..");
const DEFAULT_TIMEOUT_S = 60;

function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/** What a matcher is tested against: the tool for tool events, the source for SessionStart. */
function matchKey(input) {
  if (typeof input.tool_name === "string") return input.tool_name;
  if (typeof input.source === "string") return input.source;
  return "";
}

/** Claude Code's rule: no matcher, an empty one or `*` matches everything; otherwise a regex. */
function matches(matcher, key) {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(key);
  } catch {
    return false;
  }
}

/** The command hooks this repository registers for an event, in order, that match the input. */
function hooksFor(settings, event, input) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) return [];
  const key = matchKey(input);
  return groups
    .filter((group) => matches(group.matcher, key))
    .flatMap((group) => (Array.isArray(group.hooks) ? group.hooks : []))
    .filter((hook) => hook && hook.type === "command" && typeof hook.command === "string");
}

/** One hook's answer: its additionalContext, or its plain stdout, which Claude Code also reads. */
function contextOf(stdout) {
  const text = (stdout || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return parsed?.hookSpecificOutput?.additionalContext ?? "";
  } catch {
    return text;
  }
}

function run(raw, input, repoRoot = REPO_ROOT, env = process.env) {
  const event = input.hook_event_name;
  if (typeof event !== "string" || !event) return { code: 0 };
  if (env.CLAUDE_PROJECT_DIR && samePath(env.CLAUDE_PROJECT_DIR, repoRoot)) return { code: 0 };

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
  } catch {
    return { code: 0 };
  }

  const contexts = [];
  for (const hook of hooksFor(settings, event, input)) {
    const timeout = (Number(hook.timeout) > 0 ? Number(hook.timeout) : DEFAULT_TIMEOUT_S) * 1000;
    const result = spawnSync("sh", ["-c", hook.command], {
      cwd: repoRoot,
      input: raw,
      encoding: "utf8",
      timeout,
      env: { ...env, CLAUDE_PROJECT_DIR: repoRoot },
    });
    if (result.status === 2) return { code: 2, stderr: result.stderr || "" };
    const context = contextOf(result.stdout);
    if (context) contexts.push(context);
  }
  if (contexts.length === 0) return { code: 0 };
  return {
    code: 0,
    stdout: `${JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: contexts.join("\n\n") },
    })}\n`,
  };
}

function main() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    // No input: nothing to route.
  }
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return 0;
  }
  const result = run(raw, input);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.code;
}

if (require.main === module) {
  let code = 0;
  try {
    code = main();
  } catch {
    // Deliberately silent: see the header.
  }
  process.exit(code);
}

module.exports = { contextOf, hooksFor, matches, run };
