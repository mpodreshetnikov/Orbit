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
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = process.env.PROJECT_HOOKS_BRIDGE_REPO_ROOT
  ? path.resolve(process.env.PROJECT_HOOKS_BRIDGE_REPO_ROOT)
  : path.resolve(__dirname, "..", "..");
// Claude Code's default for a command hook without `timeout`.
const DEFAULT_TIMEOUT_S = 600;
// The strongest of each structured decision wins when several hooks answer one event.
const PERMISSION_RANK = { allow: 0, ask: 1, defer: 2, deny: 3 };
// What each event's matcher is tested against; tool events use `tool_name`.
const MATCH_FIELD = {
  SessionStart: "source",
  SessionEnd: "reason",
  Notification: "notification_type",
  SubagentStart: "agent_type",
  SubagentStop: "agent_type",
  PreCompact: "trigger",
  PostCompact: "trigger",
};
// The events whose plain (non-JSON) stdout Claude Code adds to the context; elsewhere it only logs it.
const PLAIN_STDOUT_IS_CONTEXT = new Set([
  "UserPromptSubmit",
  "UserPromptExpansion",
  "SessionStart",
  "PostModelSwitch",
]);

function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/** What a matcher is tested against: the tool for tool events, the event's own field otherwise. */
function matchKey(input) {
  const field = MATCH_FIELD[input.hook_event_name] ?? "tool_name";
  return typeof input[field] === "string" ? input[field] : "";
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

/**
 * One hook's answer as Claude Code reads it: its JSON object, or plain stdout as context on the
 * events that take it that way (on the others Claude Code only logs it).
 */
function answerOf(stdout, event) {
  const text = (stdout || "").trim();
  if (!text) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Plain text.
  }
  if (parsed && typeof parsed === "object") return parsed;
  return event === undefined || PLAIN_STDOUT_IS_CONTEXT.has(event) ? { plain: text } : null;
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

/** The session's directory when it still exists, as Claude Code runs hooks there; else this repository. */
function workingDirectory(input, repoRoot) {
  try {
    if (typeof input.cwd === "string" && fs.statSync(input.cwd).isDirectory()) return input.cwd;
  } catch {
    // Gone: fall back.
  }
  return repoRoot;
}

/**
 * The program and arguments to start: exec form runs the command itself with its argument vector,
 * `${CLAUDE_PROJECT_DIR}` expanded as Claude Code expands it there; shell form goes through sh,
 * which expands the variable itself.
 */
function argvOf(hook, repoRoot) {
  if (!Array.isArray(hook.args)) return ["sh", ["-c", hook.command]];
  const expand = (value) =>
    String(value).replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR\b/g, repoRoot);
  return [expand(hook.command), hook.args.map(expand)];
}

function spawnHook(hook, raw, input, repoRoot, env) {
  const [program, args] = argvOf(hook, repoRoot);
  const cwd = workingDirectory(input, repoRoot);
  const childEnv = { ...env, CLAUDE_PROJECT_DIR: repoRoot };
  if (hook.async === true) {
    // In the background, as Claude Code runs it: no wait, no timeout, no answer. The input goes
    // through an unlinked file so it survives this process exiting.
    const file = path.join(os.tmpdir(), `project-hooks-bridge-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, raw);
    const fd = fs.openSync(file, "r");
    fs.unlinkSync(file);
    spawn(program, args, { cwd, env: childEnv, detached: true, stdio: [fd, "ignore", "ignore"] })
      .on("error", () => {})
      .unref();
    fs.closeSync(fd);
    return null;
  }
  const timeout = (Number(hook.timeout) > 0 ? Number(hook.timeout) : DEFAULT_TIMEOUT_S) * 1000;
  return spawnSync(program, args, { cwd, input: raw, encoding: "utf8", timeout, env: childEnv });
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
  // A blocking hook's JSON still counts, its reason standing in for stderr; a hook marked
  // `onFailure: "block"` blocks when it fails, cannot start or times out.
  const answers = [];
  const blocks = [];
  for (const hook of hooksFor(settings, event, input)) {
    const result = spawnHook(hook, raw, input, repoRoot, env);
    if (result === null) continue;
    // A hook that exits without reading its input leaves the write to its stdin with EPIPE; that
    // is the hook's choice, not a failure, and its exit status still stands.
    const error = result.error?.code === "EPIPE" ? undefined : result.error;
    const failed = error !== undefined || result.status !== 0;
    if (result.status === 2 || (failed && hook.onFailure === "block")) {
      const answer = answerOf(result.stdout);
      if (answer && !answer.plain) answers.push(answer);
      blocks.push(
        result.stderr || `${hook.command}: ${error ? error.message : `exited ${result.status}`}`,
      );
      continue;
    }
    if (failed) continue;
    const answer = answerOf(result.stdout, event);
    if (answer) answers.push(answer);
  }
  const merged = mergeAnswers(event, answers);
  if (blocks.length > 0) {
    const out = merged ? `${JSON.stringify(merged)}\n` : undefined;
    return { code: 2, stderr: blocks.join("\n"), stdout: out };
  }
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
