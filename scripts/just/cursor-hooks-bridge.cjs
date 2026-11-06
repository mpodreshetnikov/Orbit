#!/usr/bin/env node

/**
 * Adapts Cursor Agent hook events so this repository's Claude Code hooks still run.
 *
 * Cursor Cloud loads `.cursor/hooks.json`, not the Claude multi-repo bridge in
 * `~/.claude/settings.json` (T-261106-kp8). Desktop Cursor can also import `.claude/settings.json`
 * as third-party hooks, but Cloud Agents only guarantee project hooks — and Claude matchers / tool
 * names are not 1:1 with Cursor's (`Bash` vs `Shell`, `SessionStart` vs `sessionStart`,
 * `afterFileEdit` instead of `PostToolUse` for edits).
 *
 * This adapter maps Cursor stdin JSON into the Claude-shaped input `project-hooks-bridge.cjs`
 * expects, forces the bridge to run (Cursor already sets `CLAUDE_PROJECT_DIR` to the project root,
 * which would otherwise make the bridge no-op), and rewrites Claude's `additionalContext` into
 * Cursor's `additional_context`. Failures are silent and exit 0, like the hooks it runs.
 *
 * Managed Cloud does not fire `sessionStart` / `sessionEnd` (Cursor docs): those entries stay
 * wired for desktop / self-hosted pools and are documented as unavailable on managed Cloud.
 */

const fs = require("fs");
const path = require("path");
const { run } = require("./project-hooks-bridge.cjs");

const REPO_ROOT = process.env.CURSOR_HOOKS_BRIDGE_REPO_ROOT
  ? path.resolve(process.env.CURSOR_HOOKS_BRIDGE_REPO_ROOT)
  : path.resolve(__dirname, "..", "..");

/** Cursor event name → Claude Code hook_event_name. */
const EVENT_MAP = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  beforeShellExecution: "PreToolUse",
  afterShellExecution: "PostToolUse",
  afterFileEdit: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  preCompact: "PreCompact",
  stop: "Stop",
  subagentStop: "SubagentStop",
  subagentStart: "SubagentStart",
};

/**
 * Cursor tool names → Claude Code tool names the matchers in `.claude/settings.json` expect.
 * `afterFileEdit` / shell-specific events synthesize a tool name when Cursor does not send one.
 */
const TOOL_MAP = {
  Shell: "Bash",
  Bash: "Bash",
  Write: "Write",
  Edit: "Edit",
  StrReplace: "Edit",
  ApplyPatch: "Edit",
  NotebookEdit: "NotebookEdit",
  EditNotebook: "NotebookEdit",
  MultiEdit: "MultiEdit",
};

function mapToolName(name) {
  if (typeof name !== "string" || !name) return name;
  return TOOL_MAP[name] ?? name;
}

/**
 * Build the Claude-shaped payload the bridge and hook scripts understand.
 * @returns {{ event: string, input: object } | null}
 */
function adapt(cursorInput) {
  const cursorEvent =
    typeof cursorInput.hook_event_name === "string" ? cursorInput.hook_event_name : "";
  const event = EVENT_MAP[cursorEvent];
  if (!event) return null;

  const input = {
    ...cursorInput,
    hook_event_name: event,
    cwd: cursorInput.cwd ?? cursorInput.workspace_roots?.[0] ?? REPO_ROOT,
    session_id: cursorInput.session_id ?? cursorInput.conversation_id,
  };

  if (cursorEvent === "sessionStart") {
    // Caveman only activates on fresh starts; treat Cursor sessionStart as startup.
    if (typeof input.source !== "string") input.source = "startup";
  }

  if (cursorEvent === "beforeShellExecution" || cursorEvent === "afterShellExecution") {
    input.tool_name = "Bash";
    input.tool_input = {
      ...(typeof input.tool_input === "object" && input.tool_input ? input.tool_input : {}),
      command: cursorInput.command ?? input.tool_input?.command ?? "",
    };
  } else if (cursorEvent === "afterFileEdit") {
    input.tool_name = "Write";
    input.tool_input = {
      ...(typeof input.tool_input === "object" && input.tool_input ? input.tool_input : {}),
      file_path: cursorInput.file_path ?? input.tool_input?.file_path ?? "",
    };
  } else if (typeof input.tool_name === "string") {
    input.tool_name = mapToolName(input.tool_name);
  }

  return { event, input };
}

/** Claude nested answer → Cursor flat fields where Cursor expects them. */
function toCursorOutput(claudeStdout) {
  const text = (claudeStdout || "").trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { additional_context: text };
  }
  if (!parsed || typeof parsed !== "object") return null;

  const out = { ...parsed };
  const specific = parsed.hookSpecificOutput;
  if (specific && typeof specific === "object") {
    if (typeof specific.additionalContext === "string" && specific.additionalContext) {
      out.additional_context = [out.additional_context, specific.additionalContext]
        .filter(Boolean)
        .join("\n\n");
    }
    if (typeof specific.permissionDecision === "string") {
      out.permission = specific.permissionDecision;
    }
    if (typeof specific.permissionDecisionReason === "string") {
      out.user_message = specific.permissionDecisionReason;
    }
  }
  return out;
}

function runAdapted(cursorInput, repoRoot = REPO_ROOT, env = process.env) {
  const adapted = adapt(cursorInput);
  if (!adapted) return { code: 0 };

  const raw = JSON.stringify(adapted.input);
  const result = run(raw, adapted.input, repoRoot, {
    ...env,
    PROJECT_HOOKS_BRIDGE_FORCE: "1",
    PROJECT_HOOKS_BRIDGE_REPO_ROOT: repoRoot,
    // Bridge no-ops when CLAUDE_PROJECT_DIR is this repo (Claude already ran the hooks). Cursor
    // sets that alias, so clear it for the forced run.
    CLAUDE_PROJECT_DIR: "",
  });

  const cursorOut = toCursorOutput(result.stdout);
  return {
    code: result.code ?? 0,
    stdout: cursorOut ? `${JSON.stringify(cursorOut)}\n` : undefined,
    stderr: result.stderr,
  };
}

function main() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return 0;
  }
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return 0;
  }
  const result = runAdapted(input);
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

module.exports = { EVENT_MAP, TOOL_MAP, adapt, mapToolName, runAdapted, toCursorOutput };
