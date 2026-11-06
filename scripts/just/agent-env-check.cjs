#!/usr/bin/env node

/**
 * Whether this repository's agent hooks reach the session that runs it, and a refusal when they
 * do not.
 *
 * Two cloud surfaces exist:
 *
 * - Claude Code (`CLAUDE_CODE_REMOTE=true`): a multi-repo session starts above the clones and loads
 *   no hooks from `.claude/settings.json`. They reach the session only through
 *   `project-hooks-bridge.cjs` registered in `~/.claude/settings.json` (docs/AGENT_ENVIRONMENT.md).
 * - Cursor Cloud (`CURSOR_AGENT=1` or `CURSOR_CODE_REMOTE=true`): the session loads
 *   `.cursor/hooks.json`. That file must route the safety events through
 *   `cursor-hooks-bridge.cjs`, and Cursor's `~/.cursor/agent-hooks/...` dispatcher must chain this
 *   repository's `.githooks` (T-261106-kp8). Claude Code's setup alone does not cover Cursor.
 *
 * Exit 1 is a refusal: CLAUDE.md / AGENTS.md tell an agent to stop, and `tasks-claim` refuses to
 * claim anything, so no work in this repository can be started properly without it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { gitHooksProblem } = require("./cursor-agent-git-hooks.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE = "project-hooks-bridge.cjs";
const CURSOR_BRIDGE = "cursor-hooks-bridge.cjs";
const DOC = "docs/AGENT_ENVIRONMENT.md";

/** Cursor events that must reach the Claude-shaped bridge for the gates this repository ships. */
const CURSOR_REQUIRED_EVENTS = [
  "afterFileEdit",
  "beforeShellExecution",
  "afterShellExecution",
  "postToolUseFailure",
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The bridge file a hook command names, when it names one.
 * Relative `./scripts/...` forms must not be mistaken for absolute `/scripts/...`.
 */
function bridgePathIn(command, bridgeName = BRIDGE, repoRoot = REPO_ROOT) {
  if (typeof command !== "string" || !command.includes(bridgeName)) return null;
  const escaped = bridgeName.replace(/\./g, "\\.");
  // Absolute UNIX path not preceded by a dot (avoids matching `./scripts/...`).
  const abs = new RegExp(`(?:^|[^.\\w])(/[^\\s"']*${escaped})`).exec(command);
  if (abs) return abs[1];
  // Project-relative form: `node ./scripts/just/cursor-hooks-bridge.cjs`
  if (command.includes(`scripts/just/${bridgeName}`)) {
    return path.join(repoRoot, "scripts", "just", bridgeName);
  }
  return null;
}

/**
 * The events this repository registers hooks on that the user settings do not route through an
 * existing bridge for every input. A bridge behind a matcher or an `if` sees only some of the
 * event's calls, so it does not count. Empty means every hook here reaches the session.
 */
function missingEvents(projectSettings, userSettings, exists = fs.existsSync) {
  const needed = Object.keys(projectSettings?.hooks ?? {});
  const unfiltered = (matcher) => matcher === undefined || matcher === "" || matcher === "*";
  return needed.filter((event) => {
    const groups = userSettings?.hooks?.[event];
    if (!Array.isArray(groups)) return true;
    return !groups.some(
      (group) =>
        unfiltered(group?.matcher) &&
        (group?.hooks ?? []).some((hook) => {
          const bridge = bridgePathIn(hook?.command);
          return (
            hook?.type === "command" &&
            hook.if === undefined &&
            hook.async !== true &&
            bridge !== null &&
            exists(bridge)
          );
        }),
    );
  });
}

/**
 * The hooks here the bridge cannot run: anything but a command hook. Claude Code runs http, mcp,
 * prompt and agent hooks itself; the bridge would drop them silently, so this repository's tests
 * fail on one rather than let it go quiet in cloud sessions.
 */
function unbridgeableHooks(projectSettings) {
  const found = [];
  for (const [event, groups] of Object.entries(projectSettings?.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of group?.hooks ?? []) {
        if (hook?.type !== "command") found.push(`${event}: ${hook?.type ?? "untyped"} hook`);
      }
    }
  }
  return found;
}

function isCursorCloud(env) {
  return env.CURSOR_AGENT === "1" || env.CURSOR_CODE_REMOTE === "true";
}

function isClaudeCloud(env) {
  return env.CLAUDE_CODE_REMOTE === "true";
}

/**
 * Cursor `.cursor/hooks.json` must name the Cursor adapter on every required event. Relative
 * commands that mention the bridge script count when the file exists under this repository.
 */
function missingCursorEvents(cursorSettings, repoRoot = REPO_ROOT, exists = fs.existsSync) {
  const hooks = cursorSettings?.hooks ?? {};
  return CURSOR_REQUIRED_EVENTS.filter((event) => {
    const entries = hooks[event];
    if (!Array.isArray(entries)) return true;
    return !entries.some((entry) => {
      const bridge = bridgePathIn(entry?.command, CURSOR_BRIDGE, repoRoot);
      return bridge !== null && exists(bridge);
    });
  });
}

function checkClaude({ home, repoRoot, exists }) {
  const project = readJson(path.join(repoRoot, ".claude", "settings.json"));
  const user = readJson(path.join(home, ".claude", "settings.json"));
  const missing = missingEvents(project, user, exists);
  if (missing.length === 0) {
    return {
      ok: true,
      message: "agent-env-check: this repository's Claude hooks reach this session.",
    };
  }
  return {
    ok: false,
    message:
      `agent-env-check: REFUSED. This Claude cloud session does not run this repository's hooks for ` +
      `${missing.join(", ")}: ~/.claude/settings.json does not route ${missing.length === 1 ? "it" : "them"} ` +
      `through scripts/just/${BRIDGE}. The task-claim gate and every other hook here are silent, so ` +
      `no change to this repository may be made in this session. Stop, and ask the person to add the ` +
      `Claude block in ${DOC} to the cloud environment's setup script, then start a new session. Do not ` +
      `write ~/.claude/settings.json yourself to get past this: the environment, not the session, ` +
      `has to carry it.`,
  };
}

function checkCursor({ home, repoRoot, exists }) {
  const cursorSettings = readJson(path.join(repoRoot, ".cursor", "hooks.json"));
  const missing = missingCursorEvents(cursorSettings, repoRoot, exists);
  const gitProblem = gitHooksProblem({ repoRoot, home });
  if (missing.length === 0 && !gitProblem) {
    return {
      ok: true,
      message:
        "agent-env-check: this repository's Cursor hooks and agent-hooks git chain reach this session.",
    };
  }
  const parts = [];
  if (missing.length > 0) {
    parts.push(
      `.cursor/hooks.json does not route ${missing.join(", ")} through scripts/just/${CURSOR_BRIDGE}`,
    );
  }
  if (gitProblem) {
    parts.push(gitProblem);
  }
  return {
    ok: false,
    message:
      `agent-env-check: REFUSED. This Cursor cloud session is missing Orbit's safety gates: ` +
      `${parts.join("; ")}. The task-claim / size / git push gates are silent, so no change to this ` +
      `repository may be made in this session. Stop, and ask the person to apply the Cursor block in ` +
      `${DOC} (hooks.json + cursor-agent-git-hooks), then start a new session. Do not rewrite ` +
      `~/.cursor/agent-hooks by hand to paper over a missing environment setup.`,
  };
}

function check({
  env = process.env,
  home = os.homedir(),
  repoRoot = REPO_ROOT,
  exists = fs.existsSync,
} = {}) {
  if (isClaudeCloud(env)) {
    return checkClaude({ home, repoRoot, exists });
  }
  if (isCursorCloud(env)) {
    return checkCursor({ home, repoRoot, exists });
  }
  return {
    ok: true,
    message:
      "agent-env-check: not a cloud session; Claude hooks load from .claude/settings.json when Claude Code starts in this checkout, and Cursor loads .cursor/hooks.json from the project.",
  };
}

if (require.main === module) {
  const result = check();
  (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  CURSOR_REQUIRED_EVENTS,
  bridgePathIn,
  check,
  isClaudeCloud,
  isCursorCloud,
  missingCursorEvents,
  missingEvents,
  unbridgeableHooks,
};
