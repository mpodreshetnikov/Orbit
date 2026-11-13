#!/usr/bin/env node

/**
 * Whether this repository's agent hooks reach the session that runs it, and a refusal when they
 * do not.
 *
 * Supported agent surfaces (each has a recipe in docs/AGENT_ENVIRONMENT.md):
 *
 * - Claude Code cloud (`CLAUDE_CODE_REMOTE=true`): a multi-repo session starts above the clones and
 *   loads no hooks from `.claude/settings.json`. They reach the session only through
 *   `project-hooks-bridge.cjs` registered in `~/.claude/settings.json`.
 * - Cursor Cloud (`CURSOR_AGENT=1` or `CURSOR_CODE_REMOTE=true`): the session loads
 *   `.cursor/hooks.json`. That file must route the safety events through
 *   `cursor-hooks-bridge.cjs`, and Cursor's `~/.cursor/agent-hooks/...` dispatcher must chain this
 *   repository's `.githooks` (T-261106-kp8). Claude Code's setup alone does not cover Cursor.
 * - Codex (`CODEX_THREAD_ID` / `CODEX_CI` / `CODEX_SANDBOX` / `CODEX_SESSION_ID`): routes the same
 *   Claude-shaped events through `project-hooks-bridge.cjs` from `~/.codex/hooks.json` (and/or a
 *   trusted project `.codex/hooks.json`).
 *
 * Any other detected agent harness (OpenCode, pi, a novel `AI_AGENT=…`, bare `AGENT=1`, …) is
 * fail-closed: REFUSED. Orbit does not silently pass an unknown agent that cannot run the gates.
 * A session with no agent markers is treated as a local human checkout and passes.
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

/**
 * Cursor events that must reach the Claude-shaped bridge for the gates this repository ships.
 * Advisories only run on context-capable events (`postToolUse` / `postToolUseFailure`);
 * `beforeShellExecution` / `preToolUse` take the PreToolUse snapshot. Do not require
 * `afterFileEdit` / `afterShellExecution` — those cannot deliver `additional_context`.
 */
const CURSOR_REQUIRED_EVENTS = ["beforeShellExecution", "postToolUse", "postToolUseFailure"];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Escape every RegExp metacharacter so a bridge filename interpolates as a literal. */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The bridge file a hook command names, when it names one.
 * Relative `./scripts/...` forms must not be mistaken for absolute `/scripts/...`.
 */
function bridgePathIn(command, bridgeName = BRIDGE, repoRoot = REPO_ROOT) {
  if (typeof command !== "string" || !command.includes(bridgeName)) return null;
  const escaped = escapeRegExp(bridgeName);
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

/** Codex CLI / cloud: any of the harness markers documented for agent detection. */
function isCodexAgent(env) {
  return Boolean(
    env.CODEX_THREAD_ID ||
    env.CODEX_SESSION_ID ||
    env.CODEX_CI === "1" ||
    (typeof env.CODEX_SANDBOX === "string" && env.CODEX_SANDBOX.length > 0),
  );
}

/**
 * Label for a harness that is clearly an agent but not Claude cloud, Cursor, or Codex.
 * Local Claude (`CLAUDECODE` / `AI_AGENT=claude-code_*` without `CLAUDE_CODE_REMOTE`) is not
 * unknown: project `.claude/settings.json` loads in-checkout.
 */
function unknownAgentLabel(env) {
  if (isClaudeCloud(env) || isCursorCloud(env) || isCodexAgent(env)) return null;
  if (env.OPENCODE === "1" || env.AI_AGENT === "opencode") return "OpenCode";
  if (env.PI_CODING_AGENT === "true" || env.AI_AGENT === "pi") return "pi";
  if (typeof env.AI_AGENT === "string" && env.AI_AGENT.length > 0) {
    if (env.AI_AGENT.startsWith("claude-code_")) return null;
    return env.AI_AGENT;
  }
  if (env.AGENT === "1") return "AGENT";
  return null;
}

function codexHome(home, env = {}) {
  return typeof env.CODEX_HOME === "string" && env.CODEX_HOME.length > 0
    ? path.resolve(env.CODEX_HOME)
    : path.join(home, ".codex");
}

/** Merge Codex hook layers: user `~/.codex/hooks.json` plus trusted project `.codex/hooks.json`. */
function mergeHookSettings(...layers) {
  const hooks = {};
  for (const layer of layers) {
    for (const [event, groups] of Object.entries(layer?.hooks ?? {})) {
      if (!Array.isArray(groups)) continue;
      hooks[event] = [...(hooks[event] ?? []), ...groups];
    }
  }
  return { hooks };
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

/**
 * Refusal text for Cursor Cloud: name the exact script, where to add it, and the doc.
 * Keep this aligned with the "Cursor Cloud setup" section of docs/AGENT_ENVIRONMENT.md.
 */
function cursorRefusalMessage({ missing, gitProblem }) {
  const parts = [];
  if (missing.length > 0) {
    parts.push(
      `.cursor/hooks.json does not route ${missing.join(", ")} through scripts/just/${CURSOR_BRIDGE}`,
    );
  }
  if (gitProblem) {
    parts.push(gitProblem);
  }
  const fixLines = [];
  if (missing.length > 0) {
    fixLines.push(
      `Ensure this session's Orbit checkout includes .cursor/hooks.json that runs ` +
        `scripts/just/${CURSOR_BRIDGE} on beforeShellExecution, postToolUse, and postToolUseFailure ` +
        `(shipped with this repository; see ${DOC} § Cursor Cloud setup).`,
    );
  }
  if (gitProblem) {
    fixLines.push(
      `Add this exact line to the Cursor Cloud environment Install AND Start scripts ` +
        `(Cursor Dashboard → Cloud Agents → this environment → Install / Start), after Cursor has ` +
        `created ~/.cursor/agent-hooks/<id>/:\n` +
        `  bash /agent/repos/Orbit/scripts/cloud/configure-cursor-agent-hooks.sh\n` +
        `(from an Orbit checkout: bash scripts/cloud/configure-cursor-agent-hooks.sh). ` +
        `Then start a new session. Full steps: ${DOC} § Cursor Cloud setup.`,
    );
  }
  return (
    `agent-env-check: REFUSED. This Cursor cloud session is missing Orbit's safety gates: ` +
    `${parts.join("; ")}. The task-claim / size / git push gates are silent, so no change to this ` +
    `repository may be made in this session. Stop.\n` +
    fixLines.join("\n") +
    `\nDo not rewrite ~/.cursor/agent-hooks by hand to paper over a missing environment setup — ` +
    `the environment scripts must call configure-cursor-agent-hooks.sh so the next session gets it too.`
  );
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
  return {
    ok: false,
    message: cursorRefusalMessage({ missing, gitProblem }),
  };
}

/**
 * Codex reuses the Claude event set via project-hooks-bridge. Coverage may come from user
 * `~/.codex/hooks.json` and/or project `.codex/hooks.json` (when the project layer is trusted).
 */
function checkCodex({ home, repoRoot, exists, env = {} }) {
  const project = readJson(path.join(repoRoot, ".claude", "settings.json"));
  const user = readJson(path.join(codexHome(home, env), "hooks.json"));
  const projectCodex = readJson(path.join(repoRoot, ".codex", "hooks.json"));
  const missing = missingEvents(project, mergeHookSettings(user, projectCodex), exists);
  if (missing.length === 0) {
    return {
      ok: true,
      message: "agent-env-check: this repository's Codex hooks reach this session.",
    };
  }
  return {
    ok: false,
    message:
      `agent-env-check: REFUSED. This Codex session does not run this repository's hooks for ` +
      `${missing.join(", ")}: ~/.codex/hooks.json (and project .codex/hooks.json) do not route ` +
      `${missing.length === 1 ? "it" : "them"} through scripts/just/${BRIDGE}. The task-claim gate ` +
      `and every other hook here are silent, so no change to this repository may be made in this ` +
      `session. Stop, and ask the person to add the Codex block in ${DOC} to the environment setup ` +
      `(or trust the shipped project .codex/hooks.json), then start a new session. Do not rewrite ` +
      `~/.codex/hooks.json yourself only for this session: the environment has to carry it.`,
  };
}

function checkUnknown(label) {
  return {
    ok: false,
    message:
      `agent-env-check: REFUSED. Unsupported / unknown agent harness (${label}). Orbit's safety ` +
      `gates are fail-closed for any agent that is not a documented Claude, Cursor, or Codex recipe ` +
      `in ${DOC}. The task-claim / size / git push gates would be silent here, so no change to this ` +
      `repository may be made in this session. Stop. Ask the person to use Claude Code, Cursor, or ` +
      `Codex with the matching setup in ${DOC} — do not invent a Dashboard / environment.json ` +
      `workaround from the agent session.`,
  };
}

/**
 * Dual-repo fail-closed extras (D8 / A.6): both clones on disk, registry skills reachable,
 * orbit-tasks git hooks present. Applied on top of harness-specific hook checks for agent sessions.
 */
function checkDualRepo({ repoRoot = REPO_ROOT, exists = fs.existsSync, env = process.env } = {}) {
  const missing = [];
  const tasksRoot =
    typeof env.ORBIT_TASKS_ROOT === "string" && env.ORBIT_TASKS_ROOT
      ? path.resolve(env.ORBIT_TASKS_ROOT)
      : path.resolve(repoRoot, "..", "orbit-tasks");

  if (!exists(path.join(tasksRoot, "docs", "tasks"))) {
    missing.push(
      `orbit-tasks clone with docs/tasks not found at ${tasksRoot} (set ORBIT_TASKS_ROOT or keep the sibling checkout)`,
    );
  } else {
    for (const skill of ["task-registry", "task-status-sync", "steward"]) {
      const skillPath = path.join(tasksRoot, ".agents", "skills", skill, "SKILL.md");
      if (!exists(skillPath)) {
        missing.push(`registry skill missing: ${skillPath}`);
      }
    }
    if (!exists(path.join(tasksRoot, ".githooks", "pre-push"))) {
      missing.push(`orbit-tasks .githooks/pre-push missing under ${tasksRoot}`);
    }
  }

  const linkedSkills = path.join(repoRoot, ".agents", "skills", "task-registry", "SKILL.md");
  const claudeSkills = path.join(repoRoot, ".claude", "skills", "task-registry", "SKILL.md");
  if (
    !exists(linkedSkills) &&
    !exists(claudeSkills) &&
    !exists(path.join(tasksRoot, ".agents", "skills", "task-registry", "SKILL.md"))
  ) {
    missing.push(
      "task-registry skill not reachable from Orbit (.agents/.claude) or orbit-tasks — run orbit-tasks install-into or keep dual checkout",
    );
  }

  if (missing.length === 0) {
    return {
      ok: true,
      message: "agent-env-check: dual-repo Orbit + orbit-tasks skills/hooks reachable.",
    };
  }
  return {
    ok: false,
    message:
      `agent-env-check: REFUSED. Dual-repo / skills / hooks gap (D8):\n` +
      missing.map((m) => `  - ${m}`).join("\n") +
      `\nSee ${DOC}. Do not edit Dashboard / environment.json from the agent session.`,
  };
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   repoRoot?: string,
 *   exists?: (file: string) => boolean,
 *   requireDualRepo?: boolean,
 * }} [options]
 * @returns {{ ok: boolean, message: string }}
 */
function check({
  env = process.env,
  home = os.homedir(),
  repoRoot = REPO_ROOT,
  exists = fs.existsSync,
  requireDualRepo = true,
} = {}) {
  let harness;
  if (isClaudeCloud(env)) {
    harness = checkClaude({ home, repoRoot, exists });
  } else if (isCursorCloud(env)) {
    harness = checkCursor({ home, repoRoot, exists });
  } else if (isCodexAgent(env)) {
    harness = checkCodex({ home, repoRoot, exists, env });
  } else {
    const unknown = unknownAgentLabel(env);
    if (unknown) {
      harness = checkUnknown(unknown);
    } else {
      harness = {
        ok: true,
        message:
          "agent-env-check: not a cloud session; Claude hooks load from .claude/settings.json when Claude Code starts in this checkout, Cursor loads .cursor/hooks.json from the project, and Codex loads ~/.codex/hooks.json / .codex/hooks.json when configured.",
      };
    }
  }

  if (!harness.ok) return harness;

  // Dual-repo extras only for agent/cloud harnesses (local humans may work Orbit-only).
  if (requireDualRepo && (isClaudeCloud(env) || isCursorCloud(env) || isCodexAgent(env))) {
    const dual = checkDualRepo({ repoRoot, exists, env });
    if (!dual.ok) return dual;
    return {
      ok: true,
      message: `${harness.message} ${dual.message}`,
    };
  }
  return harness;
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
  checkDualRepo,
  cursorRefusalMessage,
  escapeRegExp,
  isClaudeCloud,
  isCodexAgent,
  isCursorCloud,
  mergeHookSettings,
  missingCursorEvents,
  missingEvents,
  unbridgeableHooks,
  unknownAgentLabel,
};
