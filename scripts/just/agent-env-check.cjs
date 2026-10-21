#!/usr/bin/env node

/**
 * Whether this repository's Claude Code hooks reach the session that runs it, and a refusal when
 * they do not.
 *
 * A cloud session holding several repositories starts above the clones and loads no hooks from this
 * repository's `.claude/settings.json`. Every check those hooks carry -- the task-claim gate first --
 * is then silent, and nothing says so (T-260902-jxe). They reach such a session only through
 * `project-hooks-bridge.cjs` registered in the container's `~/.claude/settings.json`, which the
 * environment's setup script writes (docs/AGENT_ENVIRONMENT.md). This check confirms that
 * registration covers every event this repository registers a hook on, and that the bridge it
 * names exists.
 *
 * It applies to cloud sessions (`CLAUDE_CODE_REMOTE=true`). A local session started in this
 * checkout loads `.claude/settings.json` itself; one started elsewhere is the person's own setup,
 * and the check says so without refusing.
 *
 * Exit 1 is a refusal: CLAUDE.md tells an agent to stop and hand the person the fix, and
 * `tasks-claim` refuses to claim anything, so no work in this repository can be started properly
 * without it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE = "project-hooks-bridge.cjs";
const DOC = "docs/AGENT_ENVIRONMENT.md";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The bridge file a hook command names, when it names one. */
function bridgePathIn(command) {
  if (typeof command !== "string" || !command.includes(BRIDGE)) return null;
  const match = /(\/[^\s"';]*project-hooks-bridge\.cjs)/.exec(command);
  return match ? match[1] : null;
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

function check({
  env = process.env,
  home = os.homedir(),
  repoRoot = REPO_ROOT,
  exists = fs.existsSync,
} = {}) {
  if (env.CLAUDE_CODE_REMOTE !== "true") {
    return {
      ok: true,
      message:
        "agent-env-check: not a cloud session; hooks load from .claude/settings.json when Claude Code starts in this checkout.",
    };
  }
  const project = readJson(path.join(repoRoot, ".claude", "settings.json"));
  const user = readJson(path.join(home, ".claude", "settings.json"));
  const missing = missingEvents(project, user, exists);
  if (missing.length === 0) {
    return { ok: true, message: "agent-env-check: this repository's hooks reach this session." };
  }
  return {
    ok: false,
    message:
      `agent-env-check: REFUSED. This cloud session does not run this repository's hooks for ` +
      `${missing.join(", ")}: ~/.claude/settings.json does not route ${missing.length === 1 ? "it" : "them"} ` +
      `through scripts/just/${BRIDGE}. The task-claim gate and every other hook here are silent, so ` +
      `no change to this repository may be made in this session. Stop, and ask the person to add the ` +
      `block in ${DOC} to the cloud environment's setup script, then start a new session. Do not ` +
      `write ~/.claude/settings.json yourself to get past this: the environment, not the session, ` +
      `has to carry it.`,
  };
}

if (require.main === module) {
  const result = check();
  (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { bridgePathIn, check, missingEvents, unbridgeableHooks };
