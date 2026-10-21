import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as bridge from "./project-hooks-bridge.cjs";

const { matches, passesIf } = bridge as unknown as {
  matches: (matcher: unknown, key: string) => boolean;
  passesIf: (rule: unknown, input: unknown) => boolean;
};

const BRIDGE = path.join(__dirname, "project-hooks-bridge.cjs");
const ORBIT_ROOT = path.resolve(__dirname, "..", "..");
const temporaries: string[] = [];

const say = (text: string) =>
  `echo '${JSON.stringify({ hookSpecificOutput: { hookEventName: "X", additionalContext: text } })}'`;

/** A repository whose `.claude/settings.json` registers the hooks given. */
function repo(hooks: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-hooks-bridge-"));
  temporaries.push(root);
  fs.mkdirSync(path.join(root, ".claude"));
  fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ hooks }));
  return root;
}

function runBridge(root: string, input: unknown, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [BRIDGE], {
    encoding: "utf8",
    input: JSON.stringify(input),
    env: {
      ...process.env,
      PROJECT_HOOKS_BRIDGE_REPO_ROOT: root,
      CLAUDE_PROJECT_DIR: "/home/user",
      ...env,
    },
  });
  const context = result.stdout.trim()
    ? (JSON.parse(result.stdout).hookSpecificOutput as {
        hookEventName: string;
        additionalContext: string;
      })
    : null;
  return { status: result.status, stderr: result.stderr, context };
}

afterEach(() => {
  while (temporaries.length > 0) {
    fs.rmSync(temporaries.pop() as string, { recursive: true, force: true });
  }
});

describe("matching", () => {
  it("follows Claude Code: everything, exact name lists, or an unanchored regex", () => {
    expect(matches(undefined, "Edit")).toBe(true);
    expect(matches("", "Edit")).toBe(true);
    expect(matches("*", "Bash")).toBe(true);
    expect(matches("Edit|Write|NotebookEdit", "Write")).toBe(true);
    expect(matches("Edit, Write", "Write")).toBe(true);
    expect(matches("Edit|Write", "MultiEdit")).toBe(false);
    expect(matches("^Notebook", "NotebookEdit")).toBe(true);
    expect(matches("Edit.*", "EditFile")).toBe(true);
    expect(matches("(", "Bash")).toBe(false);
  });

  it("applies a handler's if filter, and runs nothing on one it cannot read", () => {
    const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
    const edit = (file: string) => ({ tool_name: "Edit", tool_input: { file_path: file } });
    expect(passesIf(undefined, bash("ls"))).toBe(true);
    expect(passesIf("Bash(git *)", bash("git commit -m x"))).toBe(true);
    expect(passesIf("Bash(git *)", bash("ls"))).toBe(false);
    expect(passesIf("Edit(*.ts)", edit("/r/src/a.ts"))).toBe(true);
    expect(passesIf("Edit(*.ts)", edit("/r/src/a.md"))).toBe(false);
    expect(passesIf("Edit", bash("ls"))).toBe(false);
    expect(passesIf("not a rule (", bash("ls"))).toBe(false);
  });
});

describe("the bridge", () => {
  it("runs the repository's matching hooks for the event and joins what they say", () => {
    const root = repo({
      PostToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: say("one") }] },
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "echo plain two" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: say("not for edits") }] },
      ],
    });
    const out = runBridge(root, { hook_event_name: "PostToolUse", tool_name: "Write" });
    expect(out.status).toBe(0);
    expect(out.context).toEqual({
      hookEventName: "PostToolUse",
      additionalContext: "one\n\nplain two",
    });
  });

  it("hands each hook the input on stdin and this repository as CLAUDE_PROJECT_DIR", () => {
    const root = repo({
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: 'printf "%s|" "$CLAUDE_PROJECT_DIR"; cat',
            },
          ],
        },
      ],
    });
    const input = { hook_event_name: "SessionStart", source: "startup" };
    const out = runBridge(root, input);
    expect(out.context?.additionalContext).toBe(`${root}|${JSON.stringify(input)}`);
  });

  it("passes a blocking exit through with its reason, after every matching hook has run", () => {
    const root = repo({
      PreToolUse: [
        { hooks: [{ type: "command", command: "echo refused >&2; exit 2" }] },
        { hooks: [{ type: "command", command: 'touch "$CLAUDE_PROJECT_DIR/ran-after"' }] },
      ],
    });
    const out = runBridge(root, { hook_event_name: "PreToolUse", tool_name: "Bash" });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("refused");
    expect(fs.existsSync(path.join(root, "ran-after"))).toBe(true);
  });

  it("keeps structured decisions, the stricter one winning", () => {
    const answer = (fields: unknown) => `echo '${JSON.stringify(fields)}'`;
    const root = repo({
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: answer({ hookSpecificOutput: { permissionDecision: "allow" } }),
            },
            {
              type: "command",
              command: answer({
                hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no" },
              }),
            },
            { type: "command", command: say("context too") },
          ],
        },
      ],
      Stop: [
        { hooks: [{ type: "command", command: answer({ continue: false, stopReason: "x" }) }] },
      ],
    });
    const pre = spawnSync(process.execPath, [BRIDGE], {
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash" }),
      env: {
        ...process.env,
        PROJECT_HOOKS_BRIDGE_REPO_ROOT: root,
        CLAUDE_PROJECT_DIR: "/home/user",
      },
    });
    expect(JSON.parse(pre.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "no",
        additionalContext: "context too",
      },
    });
    const stop = spawnSync(process.execPath, [BRIDGE], {
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "Stop" }),
      env: {
        ...process.env,
        PROJECT_HOOKS_BRIDGE_REPO_ROOT: root,
        CLAUDE_PROJECT_DIR: "/home/user",
      },
    });
    expect(JSON.parse(stop.stdout)).toEqual({ continue: false, stopReason: "x" });
  });

  it("runs an exec-form hook with its argument vector, not through the shell", () => {
    const root = repo({
      PostToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: process.execPath,
              args: [
                "-e",
                'process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:"exec"}}))',
              ],
            },
          ],
        },
      ],
    });
    expect(
      runBridge(root, { hook_event_name: "PostToolUse", tool_name: "Edit" }).context
        ?.additionalContext,
    ).toBe("exec");
  });

  it("stays out of the way when the session already loaded this repository's hooks", () => {
    const root = repo({ PostToolUse: [{ hooks: [{ type: "command", command: say("twice") }] }] });
    const input = { hook_event_name: "PostToolUse", tool_name: "Edit" };
    expect(runBridge(root, input, { CLAUDE_PROJECT_DIR: root }).context).toBeNull();
    expect(runBridge(root, input).context?.additionalContext).toBe("twice");
  });

  it("is silent without settings, without an event, or for an event nothing is registered on", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "project-hooks-bridge-"));
    temporaries.push(empty);
    expect(runBridge(empty, { hook_event_name: "PostToolUse" })).toMatchObject({
      status: 0,
      context: null,
    });
    const root = repo({ PostToolUse: [{ hooks: [{ type: "command", command: say("x") }] }] });
    expect(runBridge(root, {})).toMatchObject({ status: 0, context: null });
    expect(runBridge(root, { hook_event_name: "Stop" })).toMatchObject({
      status: 0,
      context: null,
    });
  });

  it("reaches this repository's own task-claim check from a session started elsewhere", () => {
    const out = runBridge(ORBIT_ROOT, {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: path.join(ORBIT_ROOT, "docs", "tasks", "x.md") },
    });
    // A registry edit needs no claim; the point is that the bridge ran the real settings cleanly.
    expect(out.status).toBe(0);
    expect(out.stderr).toBe("");
  });
});
