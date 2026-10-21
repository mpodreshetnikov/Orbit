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
 * and runs the hooks that match, so the list of hooks stays here: the setup script changes only
 * when a hook here takes an event it does not route, and `agent-env-check.cjs` refuses until it
 * does.
 *
 * Each matching command runs with `CLAUDE_PROJECT_DIR` set to this repository and the hook input on
 * stdin, as Claude Code would run it: the same matcher and `if` rules, exec form when `args` is
 * given, the same default timeout. Their answers are merged into one, the stricter decision
 * winning; a hook that exits 2 -- Claude Code's "block" -- is passed through with its stderr once
 * every matching hook has run. When the session's own
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
// Claude Code's default for a command hook without `timeout`.
const DEFAULT_TIMEOUT_S = 600;
// The strongest of each structured decision wins when several hooks answer one event.
const PERMISSION_RANK = { allow: 0, ask: 1, deny: 2 };

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

/**
 * Claude Code's rule: no matcher, an empty one or `*` matches everything; a plain list of names
 * separated by `|` or `,` matches those names exactly; anything else is a regex, unanchored.
 */
function matches(matcher, key) {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (/^[A-Za-z0-9_\s|,]+$/.test(matcher)) {
    return matcher
      .split(/[|,]/)
      .map((name) => name.trim())
      .includes(key);
  }
  try {
    return new RegExp(matcher).test(key);
  } catch {
    return false;
  }
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * A handler's `if` filter, in permission-rule form: `Tool` or `Tool(pattern)`, the pattern a glob
 * over the command for Bash and over the path for file tools. A filter this cannot read keeps the
 * handler from running, the narrower of the two mistakes.
 */
function passesIf(rule, input) {
  if (rule === undefined) return true;
  const parsed =
    typeof rule === "string" ? /^([A-Za-z0-9_]+)(?:\((.*)\))?$/.exec(rule.trim()) : null;
  if (!parsed) return false;
  const [, tool, pattern] = parsed;
  if (tool !== input.tool_name) return false;
  if (pattern === undefined) return true;
  const target = input.tool_input?.command ?? input.tool_input?.file_path ?? input.tool_input?.path;
  if (typeof target !== "string") return false;
  const glob = globToRegExp(pattern);
  return glob.test(target) || glob.test(path.basename(target));
}

/** The command hooks this repository registers for an event, in order, that match the input. */
function hooksFor(settings, event, input) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) return [];
  const key = matchKey(input);
  return groups
    .filter((group) => matches(group.matcher, key))
    .flatMap((group) => (Array.isArray(group.hooks) ? group.hooks : []))
    .filter((hook) => hook && hook.type === "command" && typeof hook.command === "string")
    .filter((hook) => passesIf(hook.if, input));
}

/** One hook's answer as Claude Code reads it: its JSON object, or plain stdout as context. */
function answerOf(stdout) {
  const text = (stdout || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { plain: text };
  } catch {
    return { plain: text };
  }
}

/** Kept for callers that only want the context of one answer. */
function contextOf(stdout) {
  const answer = answerOf(stdout);
  if (!answer) return "";
  return answer.plain ?? answer.hookSpecificOutput?.additionalContext ?? "";
}

/**
 * Several answers as one: contexts joined, every other field kept, and where two hooks decide
 * differently the stricter decision stands -- a deny over an ask over an allow, `continue: false`
 * and `decision: "block"` over their absence.
 */
function mergeAnswers(event, answers) {
  const merged = {};
  const specific = {};
  const contexts = [];
  for (const answer of answers) {
    if (answer.plain) {
      contexts.push(answer.plain);
      continue;
    }
    const { hookSpecificOutput: own = {}, ...top } = answer;
    for (const [key, value] of Object.entries(top)) {
      if (key === "continue") merged.continue = merged.continue === false ? false : value;
      else if (key === "decision") merged.decision = merged.decision === "block" ? "block" : value;
      else if (!(key in merged)) merged[key] = value;
    }
    for (const [key, value] of Object.entries(own)) {
      if (key === "hookEventName") continue;
      if (key === "additionalContext") {
        if (value) contexts.push(value);
      } else if (key === "permissionDecision") {
        const current = specific.permissionDecision;
        if (
          current === undefined ||
          (PERMISSION_RANK[value] ?? 0) > (PERMISSION_RANK[current] ?? 0)
        ) {
          specific.permissionDecision = value;
          if (own.permissionDecisionReason)
            specific.permissionDecisionReason = own.permissionDecisionReason;
        }
      } else if (key !== "permissionDecisionReason" && !(key in specific)) {
        specific[key] = value;
      }
    }
  }
  if (contexts.length > 0) specific.additionalContext = contexts.join("\n\n");
  if (Object.keys(specific).length > 0)
    merged.hookSpecificOutput = { hookEventName: event, ...specific };
  return Object.keys(merged).length > 0 ? merged : null;
}

function spawnHook(hook, raw, repoRoot, env) {
  const timeout = (Number(hook.timeout) > 0 ? Number(hook.timeout) : DEFAULT_TIMEOUT_S) * 1000;
  const options = {
    cwd: repoRoot,
    input: raw,
    encoding: "utf8",
    timeout,
    env: { ...env, CLAUDE_PROJECT_DIR: repoRoot },
  };
  // Exec form runs the command itself with its argument vector; shell form goes through sh.
  return Array.isArray(hook.args)
    ? spawnSync(hook.command, hook.args.map(String), options)
    : spawnSync("sh", ["-c", hook.command], options);
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

  // Every matching hook runs, as Claude Code runs them all; a block is reported after the last.
  const answers = [];
  const blocks = [];
  for (const hook of hooksFor(settings, event, input)) {
    const result = spawnHook(hook, raw, repoRoot, env);
    if (result.status === 2) {
      blocks.push(result.stderr || "");
      continue;
    }
    const answer = answerOf(result.stdout);
    if (answer) answers.push(answer);
  }
  if (blocks.length > 0) return { code: 2, stderr: blocks.join("\n") };
  const merged = mergeAnswers(event, answers);
  return merged ? { code: 0, stdout: `${JSON.stringify(merged)}\n` } : { code: 0 };
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

module.exports = { contextOf, hooksFor, matches, mergeAnswers, passesIf, run };
