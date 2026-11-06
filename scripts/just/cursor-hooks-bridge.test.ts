import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as adapter from "./cursor-hooks-bridge.cjs";

const { adapt, mapToolName, runAdapted, toCursorOutput } = adapter as unknown as {
  adapt: (
    input: Record<string, unknown>,
  ) => { event: string; input: Record<string, unknown> } | null;
  mapToolName: (name: string) => string;
  runAdapted: (
    input: Record<string, unknown>,
    repoRoot?: string,
    env?: Record<string, string>,
  ) => { code: number; stdout?: string; stderr?: string };
  toCursorOutput: (stdout: string | undefined) => Record<string, unknown> | null;
};

const ORBIT_ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE = path.join(__dirname, "cursor-hooks-bridge.cjs");
const temporaries: string[] = [];

afterEach(() => {
  while (temporaries.length > 0) {
    fs.rmSync(temporaries.pop() as string, { recursive: true, force: true });
  }
});

describe("Cursor → Claude adaptation", () => {
  it("maps shell and file events onto Claude tool names the settings matchers expect", () => {
    expect(mapToolName("Shell")).toBe("Bash");
    expect(mapToolName("StrReplace")).toBe("Edit");
    expect(adapt({ hook_event_name: "beforeShellExecution", command: "git status" })).toEqual({
      event: "PreToolUse",
      input: expect.objectContaining({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: expect.objectContaining({ command: "git status" }),
      }),
    });
    expect(
      adapt({ hook_event_name: "afterFileEdit", file_path: "/agent/repos/Orbit/src/x.ts" }),
    ).toEqual({
      event: "PostToolUse",
      input: expect.objectContaining({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: expect.objectContaining({ file_path: "/agent/repos/Orbit/src/x.ts" }),
      }),
    });
    expect(adapt({ hook_event_name: "sessionStart", session_id: "abc" })?.input.source).toBe(
      "startup",
    );
    expect(adapt({ hook_event_name: "afterAgentResponse" })).toBeNull();
  });

  it("rewrites Claude additionalContext into Cursor additional_context", () => {
    expect(
      toCursorOutput(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: "unclaimed edit",
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        additional_context: "unclaimed edit",
      }),
    );
  });
});

describe("forced bridge run", () => {
  it("runs this repository's PostToolUse hooks even when CLAUDE_PROJECT_DIR is the repo", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-hooks-bridge-"));
    temporaries.push(root);
    fs.mkdirSync(path.join(root, ".claude"));
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command: `echo '${JSON.stringify({
                    hookSpecificOutput: {
                      hookEventName: "PostToolUse",
                      additionalContext: "from-bridge",
                    },
                  })}'`,
                  timeout: 5,
                },
              ],
            },
          ],
        },
      }),
    );

    const result = runAdapted(
      {
        hook_event_name: "afterFileEdit",
        file_path: path.join(root, "src/a.ts"),
      },
      root,
      { ...process.env, CLAUDE_PROJECT_DIR: root },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("from-bridge");
    expect(result.stdout).toContain("additional_context");
  });

  it("exits 0 on unknown Cursor events", () => {
    const run = spawnSync(process.execPath, [BRIDGE], {
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "afterAgentThought", text: "…" }),
      env: { ...process.env, CURSOR_HOOKS_BRIDGE_REPO_ROOT: ORBIT_ROOT },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  });
});
