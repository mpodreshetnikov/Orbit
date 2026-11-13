import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as envCheck from "./agent-env-check.cjs";
import { agentHooksDir, install as installCursorGitHooks } from "./cursor-agent-git-hooks.cjs";

const { bridgePathIn, check, escapeRegExp, missingCursorEvents, missingEvents, unbridgeableHooks } =
  envCheck as unknown as {
    bridgePathIn: (command: string, bridgeName?: string, repoRoot?: string) => string | null;
    check: (options: {
      env: Record<string, string>;
      home: string;
      repoRoot?: string;
      exists?: (file: string) => boolean;
    }) => { ok: boolean; message: string };
    escapeRegExp: (value: string) => string;
    missingCursorEvents: (
      settings: unknown,
      repoRoot?: string,
      exists?: (file: string) => boolean,
    ) => string[];
    missingEvents: (
      project: unknown,
      user: unknown,
      exists?: (file: string) => boolean,
    ) => string[];
    unbridgeableHooks: (project: unknown) => string[];
  };

const ORBIT_ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE = path.join(ORBIT_ROOT, "scripts", "just", "project-hooks-bridge.cjs");
const CURSOR_BRIDGE = path.join(ORBIT_ROOT, "scripts", "just", "cursor-hooks-bridge.cjs");
const DOC = path.join(ORBIT_ROOT, "docs", "AGENT_ENVIRONMENT.md");
const temporaries: string[] = [];

/**
 * The settings the documented Claude setup-script block writes, read from the document and written
 * to a scratch HOME. Parsed rather than run: the test checks what the block says, not the shell.
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

/**
 * The settings the documented Codex setup-script block writes, read from the document.
 * Codex uses the same bridge file as Claude; only the destination path differs.
 */
function homeFromDocumentedCodexBlock(bridge = BRIDGE) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-codex-ok-"));
  temporaries.push(home);
  const doc = fs.readFileSync(DOC, "utf8");
  const json = /cat > ~\/\.codex\/hooks\.json <<'JSON'\n([\s\S]*?)\nJSON\n/.exec(doc)?.[1];
  expect(json).toBeTruthy();
  const settings = JSON.parse(
    (json as string).replaceAll("/home/user/Orbit/scripts/just/project-hooks-bridge.cjs", bridge),
  );
  fs.mkdirSync(path.join(home, ".codex"));
  fs.writeFileSync(path.join(home, ".codex", "hooks.json"), JSON.stringify(settings));
  return home;
}

function cursorRepoWithGitHooks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-cursor-repo-"));
  temporaries.push(root);
  fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts", "just"), { recursive: true });
  fs.mkdirSync(path.join(root, ".githooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(root, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  fs.copyFileSync(CURSOR_BRIDGE, path.join(root, "scripts", "just", "cursor-hooks-bridge.cjs"));
  fs.writeFileSync(
    path.join(root, ".cursor", "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        beforeShellExecution: [{ command: "node ./scripts/just/cursor-hooks-bridge.cjs" }],
        postToolUse: [{ command: "node ./scripts/just/cursor-hooks-bridge.cjs" }],
        postToolUseFailure: [{ command: "node ./scripts/just/cursor-hooks-bridge.cjs" }],
      },
    }),
  );
  return root;
}

afterEach(() => {
  while (temporaries.length > 0) {
    fs.rmSync(temporaries.pop() as string, { recursive: true, force: true });
  }
});

describe("bridgePathIn escaping", () => {
  it("treats bridge filenames as literals, including backslashes and other metacharacters", () => {
    expect(escapeRegExp("a.b+c")).toBe("a\\.b\\+c");
    expect(escapeRegExp("x\\y")).toBe("x\\\\y");
    // Escaping only `.` would leave `+` as "one or more", matching `projectthooks-bridge.cjs`.
    const plusName = "project+hooks-bridge.cjs";
    expect(bridgePathIn(`node /opt/${plusName}`, plusName, "/repo")).toBe(`/opt/${plusName}`);
    expect(bridgePathIn("node /opt/projectthooks-bridge.cjs", plusName, "/repo")).toBeNull();
  });
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

  it("does not count a bridge that sees only some of the event's calls", () => {
    const bridge = "node /x/scripts/just/project-hooks-bridge.cjs";
    const limited = (group: object) => ({
      hooks: { PostToolUse: [group], SessionStart: via(bridge) },
    });
    const hook = { type: "command", command: bridge };
    expect(missingEvents(project, limited({ matcher: "Bash", hooks: [hook] }), () => true)).toEqual(
      ["PostToolUse"],
    );
    expect(
      missingEvents(project, limited({ hooks: [{ ...hook, if: "Bash(git *)" }] }), () => true),
    ).toEqual(["PostToolUse"]);
    expect(missingEvents(project, limited({ matcher: "*", hooks: [hook] }), () => true)).toEqual(
      [],
    );
  });

  it("does not count some other hook on the event", () => {
    const user = { hooks: { PostToolUse: via("echo hi"), SessionStart: via("echo hi") } };
    expect(missingEvents(project, user, () => true)).toEqual(["PostToolUse", "SessionStart"]);
  });
});

describe("Cursor hooks.json coverage", () => {
  it("requires the Cursor adapter on the context-capable safety events", () => {
    expect(missingCursorEvents({ hooks: {} }, ORBIT_ROOT, () => true)).toEqual([
      "beforeShellExecution",
      "postToolUse",
      "postToolUseFailure",
    ]);
    const wired = JSON.parse(
      fs.readFileSync(path.join(ORBIT_ROOT, ".cursor", "hooks.json"), "utf8"),
    );
    expect(missingCursorEvents(wired, ORBIT_ROOT)).toEqual([]);
  });
});

describe("what the bridge can run", () => {
  it("names hooks that are not commands", () => {
    expect(
      unbridgeableHooks({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }, { type: "prompt" }] }] },
      }),
    ).toEqual(["Stop: prompt hook"]);
  });

  it("finds none in this repository's settings, or they would be silent in cloud sessions", () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(ORBIT_ROOT, ".claude", "settings.json"), "utf8"),
    );
    expect(unbridgeableHooks(settings)).toEqual([]);
  });
});

describe("the check", () => {
  it("refuses a Claude cloud session without the setup-script block, and names the fix", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-"));
    temporaries.push(home);
    const result = check({ env: { CLAUDE_CODE_REMOTE: "true" }, home });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("REFUSED");
    expect(result.message).toContain("docs/AGENT_ENVIRONMENT.md");
  });

  it("passes a Claude cloud session whose environment ran the documented block", () => {
    const home = homeFromDocumentedBlock();
    expect(check({ env: { CLAUDE_CODE_REMOTE: "true" }, home }).ok).toBe(true);
  });

  it("refuses when the Claude block names a bridge that is not there", () => {
    const home = homeFromDocumentedBlock("/nowhere/scripts/just/project-hooks-bridge.cjs");
    expect(check({ env: { CLAUDE_CODE_REMOTE: "true" }, home }).ok).toBe(false);
  });

  it("refuses a Cursor cloud session until hooks.json and agent-hooks git chain are wired", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-cursor-"));
    temporaries.push(home);
    const result = check({
      env: { CURSOR_AGENT: "1" },
      home,
      repoRoot: ORBIT_ROOT,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("REFUSED");
    expect(result.message).toMatch(/agent-hooks|pre-push|cursor-hooks-bridge/);
    // Operator-facing fix: exact script + where to put it + doc (Maxim / env owner).
    expect(result.message).toContain(
      "bash /agent/repos/Orbit/scripts/cloud/configure-cursor-agent-hooks.sh",
    );
    expect(result.message).toMatch(/Install AND Start/);
    expect(result.message).toContain("docs/AGENT_ENVIRONMENT.md");
  });

  it("passes a Cursor cloud session with hooks.json and agent-hooks git chain", () => {
    const repoRoot = cursorRepoWithGitHooks();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-cursor-ok-"));
    temporaries.push(home);
    const hooksDir = agentHooksDir(repoRoot, home);
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, ".dispatcher"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(installCursorGitHooks({ repoRoot, home }).ok).toBe(true);
    expect(check({ env: { CURSOR_AGENT: "1" }, home, repoRoot, requireDualRepo: false }).ok).toBe(
      true,
    );
  });

  it("does not apply outside the cloud", () => {
    const result = check({ env: {}, home: "/nonexistent" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("not a cloud session");
  });

  it("refuses an unknown agent harness fail-closed (no silent pass)", () => {
    const cases: Record<string, string>[] = [
      { OPENCODE: "1", AGENT: "1" },
      { PI_CODING_AGENT: "true", AI_AGENT: "pi" },
      { AI_AGENT: "some-new-harness_1-0" },
      { AGENT: "1" },
    ];
    for (const env of cases) {
      const result = check({ env, home: "/nonexistent" });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("REFUSED");
      expect(result.message).toMatch(/unknown|unsupported/i);
      expect(result.message).toContain("docs/AGENT_ENVIRONMENT.md");
      expect(result.message).toMatch(/Claude|Cursor|Codex/);
    }
  });

  it("refuses a Codex session until hooks.json routes the bridge", () => {
    // Scratch checkout: no project .codex/hooks.json and empty HOME — must REFUSE.
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-codex-repo-"));
    temporaries.push(repoRoot);
    fs.mkdirSync(path.join(repoRoot, ".claude"), { recursive: true });
    fs.copyFileSync(
      path.join(ORBIT_ROOT, ".claude", "settings.json"),
      path.join(repoRoot, ".claude", "settings.json"),
    );
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-codex-"));
    temporaries.push(home);
    const result = check({
      env: { CODEX_THREAD_ID: "thread-test" },
      home,
      repoRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("REFUSED");
    expect(result.message).toMatch(/Codex|codex/);
    expect(result.message).toContain("docs/AGENT_ENVIRONMENT.md");
    expect(result.message).toContain("project-hooks-bridge.cjs");
  });

  it("passes a Codex session whose environment ran the documented Codex block", () => {
    // Scratch tree without project .codex/hooks.json so only the documented user block counts.
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-codex-pass-"));
    temporaries.push(repoRoot);
    fs.mkdirSync(path.join(repoRoot, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "scripts", "just"), { recursive: true });
    fs.copyFileSync(
      path.join(ORBIT_ROOT, ".claude", "settings.json"),
      path.join(repoRoot, ".claude", "settings.json"),
    );
    fs.copyFileSync(BRIDGE, path.join(repoRoot, "scripts", "just", "project-hooks-bridge.cjs"));
    const home = homeFromDocumentedCodexBlock(
      path.join(repoRoot, "scripts", "just", "project-hooks-bridge.cjs"),
    );
    expect(check({ env: { CODEX_CI: "1" }, home, repoRoot, requireDualRepo: false }).ok).toBe(true);
  });

  it("passes a Codex session when the shipped project .codex/hooks.json covers the bridge", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-codex-project-"));
    temporaries.push(home);
    expect(
      check({
        env: { CODEX_SANDBOX: "seatbelt" },
        home,
        repoRoot: ORBIT_ROOT,
        requireDualRepo: false,
      }).ok,
    ).toBe(true);
  });

  it("exits 1 on a Claude refusal, which is what CLAUDE.md and tasks-claim stop on", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-check-"));
    temporaries.push(home);
    const run = spawnSync(process.execPath, [path.join(__dirname, "agent-env-check.cjs")], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_REMOTE: "true", HOME: home, CURSOR_AGENT: "" },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("REFUSED");

    const claim = spawnSync(
      process.execPath,
      [path.join(__dirname, "tasks-claim-here.cjs"), "T-260902-jxe"],
      {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_CODE_REMOTE: "true", HOME: home, CURSOR_AGENT: "" },
      },
    );
    expect(claim.status).toBe(1);
    expect(claim.stderr).toContain("REFUSED");
  });
});
