import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as envCheck from "./agent-env-check.cjs";

const { check, missingEvents } = envCheck as unknown as {
  check: (options: {
    env: Record<string, string>;
    home: string;
    repoRoot?: string;
    exists?: (file: string) => boolean;
  }) => { ok: boolean; message: string };
  missingEvents: (project: unknown, user: unknown, exists?: (file: string) => boolean) => string[];
};

const ORBIT_ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE = path.join(ORBIT_ROOT, "scripts", "just", "project-hooks-bridge.cjs");
const DOC = path.join(ORBIT_ROOT, "docs", "AGENT_ENVIRONMENT.md");
const temporaries: string[] = [];

/**
 * The settings the documented setup-script block writes, read from the document and written to a
 * scratch HOME. Parsed rather than run: the test checks what the block says, not the shell.
 */
function homeFromDocumentedBlock(bridge = BRIDGE) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-"));
  temporaries.push(home);
  const doc = fs.readFileSync(DOC, "utf8");
  const json = /cat > ~\/\.claude\/settings\.json <<'JSON'\n([\s\S]*?)\nJSON\n/.exec(doc)?.[1];
  expect(json).toBeTruthy();
  const settings = JSON.parse(
    (json as string).replaceAll("/home/user/Orbit/scripts/just/project-hooks-bridge.cjs", bridge),
  );
  fs.mkdirSync(path.join(home, ".claude"));
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify(settings));
  return home;
}

afterEach(() => {
  while (temporaries.length > 0) {
    fs.rmSync(temporaries.pop() as string, { recursive: true, force: true });
  }
});

describe("which events are covered", () => {
  const project = { hooks: { PostToolUse: [], SessionStart: [] } };
  const via = (command: string) => [{ hooks: [{ type: "command", command }] }];

  it("wants a bridge that exists on every event this repository hooks", () => {
    const user = { hooks: { PostToolUse: via("node /x/scripts/just/project-hooks-bridge.cjs") } };
    expect(missingEvents(project, user, () => true)).toEqual(["SessionStart"]);
    expect(missingEvents(project, user, () => false)).toEqual(["PostToolUse", "SessionStart"]);
    expect(missingEvents(project, null)).toEqual(["PostToolUse", "SessionStart"]);
  });

  it("does not count some other hook on the event", () => {
    const user = { hooks: { PostToolUse: via("echo hi"), SessionStart: via("echo hi") } };
    expect(missingEvents(project, user, () => true)).toEqual(["PostToolUse", "SessionStart"]);
  });
});

describe("the check", () => {
  it("refuses a cloud session without the setup-script block, and names the fix", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-"));
    temporaries.push(home);
    const result = check({ env: { CLAUDE_CODE_REMOTE: "true" }, home });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("REFUSED");
    expect(result.message).toContain("docs/AGENT_ENVIRONMENT.md");
  });

  it("passes a cloud session whose environment ran the documented block", () => {
    const home = homeFromDocumentedBlock();
    expect(check({ env: { CLAUDE_CODE_REMOTE: "true" }, home }).ok).toBe(true);
  });

  it("refuses when the block names a bridge that is not there", () => {
    const home = homeFromDocumentedBlock("/nowhere/scripts/just/project-hooks-bridge.cjs");
    expect(check({ env: { CLAUDE_CODE_REMOTE: "true" }, home }).ok).toBe(false);
  });

  it("does not apply outside the cloud", () => {
    const result = check({ env: {}, home: "/nonexistent" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("not a cloud session");
  });

  it("exits 1 on a refusal, which is what CLAUDE.md and tasks-claim stop on", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-"));
    temporaries.push(home);
    const run = spawnSync(process.execPath, [path.join(__dirname, "agent-env-check.cjs")], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_REMOTE: "true", HOME: home },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("REFUSED");

    const claim = spawnSync(
      process.execPath,
      [path.join(__dirname, "tasks-claim-here.cjs"), "T-260902-jxe"],
      {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_CODE_REMOTE: "true", HOME: home },
      },
    );
    expect(claim.status).toBe(1);
    expect(claim.stderr).toContain("REFUSED");
  });
});
