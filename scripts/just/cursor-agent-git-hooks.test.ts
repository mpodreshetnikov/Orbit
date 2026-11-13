import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as gitHooks from "./cursor-agent-git-hooks.cjs";

const { agentHooksDir, agentHooksId, gitHooksProblem, install } = gitHooks as unknown as {
  agentHooksDir: (repoRoot: string, home?: string) => string;
  agentHooksId: (repoRoot: string) => string;
  gitHooksProblem: (options: {
    repoRoot: string;
    home: string;
    hooksDir?: string;
    githooksDir?: string;
  }) => string | null;
  install: (options: {
    repoRoot: string;
    home: string;
    hooksDir?: string;
    githooksDir?: string;
  }) => { ok: boolean; changed: string[]; message: string };
};

const temporaries: string[] = [];

afterEach(() => {
  while (temporaries.length > 0) {
    fs.rmSync(temporaries.pop() as string, { recursive: true, force: true });
  }
});

function scratchRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-agent-git-hooks-repo-"));
  temporaries.push(root);
  fs.mkdirSync(path.join(root, ".githooks"));
  fs.writeFileSync(path.join(root, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(root, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(root, ".githooks", "commit-msg"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  return root;
}

function scratchHomeWithDispatcher(repoRoot: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-agent-git-hooks-home-"));
  temporaries.push(home);
  const hooksDir = agentHooksDir(repoRoot, home);
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, ".dispatcher"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(hooksDir, ".cursor-original-hooks-path"), `${repoRoot}/.git/hooks\n`);
  fs.symlinkSync(".dispatcher", path.join(hooksDir, "pre-commit"));
  return { home, hooksDir };
}

describe("agent-hooks id", () => {
  it("base64-encodes the absolute repo path the way Cursor does", () => {
    expect(agentHooksId("/agent/repos/Orbit")).toBe(
      Buffer.from("/agent/repos/Orbit", "utf8").toString("base64"),
    );
  });
});

describe("install", () => {
  it("points original hooks at .githooks and adds the missing pre-push symlink", () => {
    const repoRoot = scratchRepo();
    const { home, hooksDir } = scratchHomeWithDispatcher(repoRoot);

    const first = install({ repoRoot, home });
    expect(first.ok).toBe(true);
    expect(first.changed).toEqual(
      expect.arrayContaining([
        "symlink pre-push",
        "symlink commit-msg",
        ".cursor-original-hooks-path",
      ]),
    );
    expect(fs.readlinkSync(path.join(hooksDir, "pre-push"))).toBe(".dispatcher");
    expect(fs.readlinkSync(path.join(hooksDir, "commit-msg"))).toBe(".dispatcher");
    expect(fs.readFileSync(path.join(hooksDir, ".cursor-original-hooks-path"), "utf8").trim()).toBe(
      path.join(repoRoot, ".githooks"),
    );

    const second = install({ repoRoot, home });
    expect(second.ok).toBe(true);
    expect(second.changed).toEqual([]);
    expect(gitHooksProblem({ repoRoot, home })).toBeNull();
  });

  it("refuses when Cursor has not created the agent-hooks directory", () => {
    const repoRoot = scratchRepo();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-agent-git-hooks-empty-"));
    temporaries.push(home);
    const result = install({ repoRoot, home });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("does not exist yet");
  });
});

describe("gitHooksProblem", () => {
  it("names a pre-push that still points at .git/hooks samples", () => {
    const repoRoot = scratchRepo();
    const { home, hooksDir } = scratchHomeWithDispatcher(repoRoot);
    fs.symlinkSync(".dispatcher", path.join(hooksDir, "pre-push"));
    fs.symlinkSync(".dispatcher", path.join(hooksDir, "commit-msg"));
    expect(gitHooksProblem({ repoRoot, home })).toContain(".git/hooks");
  });

  it("names a missing commit-msg dispatcher link when tracked", () => {
    const repoRoot = scratchRepo();
    const { home, hooksDir } = scratchHomeWithDispatcher(repoRoot);
    fs.symlinkSync(".dispatcher", path.join(hooksDir, "pre-push"));
    fs.writeFileSync(path.join(hooksDir, ".cursor-original-hooks-path"), `${repoRoot}/.githooks\n`);
    expect(gitHooksProblem({ repoRoot, home })).toMatch(/commit-msg/);
  });
});
