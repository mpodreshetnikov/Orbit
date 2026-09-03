import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as hook from "./task-claim-hook.cjs";

const {
  changedPathsOutsideRegistry,
  evaluate,
  gitPath,
  writePreSnapshot,
  isRegistryPath,
  locateRegistry,
  message,
  shouldReport,
  taskStatusOnMain,
} = hook as unknown as {
  changedPathsOutsideRegistry: (repoRoot: string, snapshot?: unknown) => string[];
  writePreSnapshot: (repoRoot: string, snapshotPath?: string) => unknown;
  gitPath: (name: string, repoRoot: string) => string;
  evaluate: (input: {
    marker: string | null;
    registryRoot: string | null;
    statusOf: (id: string) => string | null;
  }) => { verdict: string; id?: string; status?: string };
  isRegistryPath: (filePath: string, repoRoot?: string) => boolean;
  locateRegistry: (repoRoot: string, env: Record<string, string>) => string | null;
  message: (result: { verdict: string; id?: string; status?: string }, filePath: string) => string;
  shouldReport: (key: string, statePath: string, now: number) => boolean;
  taskStatusOnMain: (registryRoot: string, id: string) => string | null;
};

const HOOK = path.join(__dirname, "task-claim-hook.cjs");
const ORBIT_ROOT = path.resolve(__dirname, "..", "..");
const temporaries: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** A registry clone whose origin/main holds the tasks given, and an empty code checkout beside it. */
function fixture(tasks: { id: string; status: string }[]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "task-claim-hook-"));
  temporaries.push(base);
  const origin = path.join(base, "origin.git");
  const registry = path.join(base, "orbit-tasks");
  const code = path.join(base, "orbit");

  git(base, "init", "-q", "--bare", "--initial-branch=main", origin);
  git(base, "init", "-q", "-b", "main", registry);
  git(registry, "config", "user.email", "t@example.com");
  git(registry, "config", "user.name", "t");
  const dir = path.join(registry, "docs", "tasks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# registry\n");
  for (const task of tasks) {
    fs.writeFileSync(
      path.join(dir, `${task.id}-slug.md`),
      `---\nid: ${task.id}\ntitle: Slug\nstatus: ${task.status}\nowner: t@example.com\n---\n\n# Slug\n`,
    );
  }
  git(registry, "add", "-A");
  git(registry, "commit", "-q", "-m", "registry");
  git(registry, "remote", "add", "origin", origin);
  git(registry, "push", "-q", "-u", "origin", "main");

  git(base, "init", "-q", "-b", "main", code);
  // The tests commit here; a CI runner has no git identity of its own.
  git(code, "config", "user.email", "t@example.com");
  git(code, "config", "user.name", "t");
  fs.mkdirSync(path.join(code, "src"), { recursive: true });
  return { base, registry, code };
}

function runHook(
  code: string,
  input: unknown,
  env: Record<string, string> = {},
  args: string[] = [],
) {
  const result = spawnSync(process.execPath, [HOOK, ...args], {
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...process.env, TASK_CLAIM_HOOK_REPO_ROOT: code, ORBIT_TASKS_REGISTRY: "", ...env },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout.trim()
    ? (JSON.parse(result.stdout).hookSpecificOutput.additionalContext as string)
    : "";
}

const edit = (code: string, file: string) => ({
  tool_name: "Edit",
  tool_input: { file_path: path.join(code, file) },
});

afterEach(() => {
  while (temporaries.length > 0) {
    fs.rmSync(temporaries.pop() as string, { recursive: true, force: true });
  }
});

describe("which edits the gate applies to", () => {
  it("leaves the registry alone: recording is how a claim is made", () => {
    expect(isRegistryPath("docs/tasks/T-260902-jxe-x.md", "/repo")).toBe(true);
    expect(isRegistryPath("/repo/docs/tasks/INDEX.md", "/repo")).toBe(true);
    expect(isRegistryPath("docs/tasks", "/repo")).toBe(true);
  });

  it("covers everything else in the tree, and nothing outside it", () => {
    expect(isRegistryPath("src/app/page.tsx", "/repo")).toBe(false);
    expect(isRegistryPath("docs/RUNBOOK.md", "/repo")).toBe(false);
    expect(isRegistryPath("/somewhere/else.md", "/repo")).toBe(true);
    expect(isRegistryPath("", "/repo")).toBe(false);
  });
});

describe("the verdict", () => {
  const board = (status: string | null) => () => status;

  it("is silent only for a marker naming a task that is in-progress on main", () => {
    expect(
      evaluate({ marker: "T-260902-jxe", registryRoot: "/r", statusOf: board("in-progress") }),
    ).toEqual({ verdict: "claimed", id: "T-260902-jxe" });
  });

  it("names each way the claim can be missing", () => {
    expect(evaluate({ marker: null, registryRoot: null, statusOf: board(null) }).verdict).toBe(
      "unlinked",
    );
    expect(evaluate({ marker: null, registryRoot: "/r", statusOf: board(null) }).verdict).toBe(
      "unclaimed",
    );
    expect(evaluate({ marker: "", registryRoot: "/r", statusOf: board(null) }).verdict).toBe(
      "unclaimed",
    );
    // A stale marker: the task closed, or never existed.
    expect(
      evaluate({ marker: "T-260902-jxe", registryRoot: "/r", statusOf: board("done") }),
    ).toEqual({ verdict: "closed", id: "T-260902-jxe", status: "done" });
    expect(evaluate({ marker: "T-260902-zzz", registryRoot: "/r", statusOf: board(null) })).toEqual(
      { verdict: "unknown", id: "T-260902-zzz" },
    );
    expect(evaluate({ marker: "garbage", registryRoot: "/r", statusOf: board(null) }).verdict).toBe(
      "unknown",
    );
  });

  it("tells the agent what to do in every case, and names the command", () => {
    for (const result of [
      { verdict: "unlinked" },
      { verdict: "unclaimed" },
      { verdict: "unknown", id: "T-1" },
      { verdict: "closed", id: "T-1", status: "done" },
    ]) {
      expect(message(result, "src/x.ts")).toContain("just tasks-claim");
      expect(message(result, "src/x.ts")).toContain("src/x.ts");
    }
    expect(message({ verdict: "claimed", id: "T-1" }, "src/x.ts")).toBe("");
  });
});

describe("how often it repeats itself", () => {
  const statePath = () =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "task-claim-hook-state-")), "state");

  it("speaks once per verdict, then again only after the interval or when the verdict changes", () => {
    const state = statePath();
    const t0 = 1_000_000;

    expect(shouldReport("unclaimed::", state, t0)).toBe(true);
    expect(shouldReport("unclaimed::", state, t0 + 1000)).toBe(false);
    expect(shouldReport("closed:T-1:done", state, t0 + 2000)).toBe(true);
    expect(shouldReport("closed:T-1:done", state, t0 + hook.REPORT_INTERVAL_MS + 3000)).toBe(true);
  });

  it("reports when the state file cannot be read", () => {
    expect(shouldReport("unclaimed::", path.join(os.tmpdir(), "no", "such", "state"), 0)).toBe(
      true,
    );
  });
});

describe("reading the board", () => {
  it("finds the registry through the environment or a sibling clone, never the checkout itself", () => {
    const { base, registry, code } = fixture([]);

    expect(locateRegistry(code, { ORBIT_TASKS_REGISTRY: registry })).toBe(registry);
    // A sibling `orbit-tasks` next to the checkout, the shape of a cloud container with both clones.
    expect(locateRegistry(code, {})).toBe(path.join(base, "orbit-tasks"));
    fs.rmSync(registry, { recursive: true, force: true });
    expect(locateRegistry(code, {})).toBeNull();
  });

  it("reads a task's status from origin/main, not from the working tree", () => {
    const { registry } = fixture([{ id: "T-260902-jxe", status: "in-progress" }]);
    // The working tree moves on; the board is what was published.
    fs.writeFileSync(
      path.join(registry, "docs", "tasks", "T-260902-jxe-slug.md"),
      "---\nid: T-260902-jxe\nstatus: done\n---\n",
    );

    expect(taskStatusOnMain(registry, "T-260902-jxe")).toBe("in-progress");
    expect(taskStatusOnMain(registry, "T-260902-zzz")).toBeNull();
  });
});

describe("the hook itself", () => {
  it("reports the first code edit of a fresh checkout as unclaimed, and a registry edit not at all", () => {
    const { registry, code } = fixture([{ id: "T-260902-jxe", status: "in-progress" }]);
    const env = { ORBIT_TASKS_REGISTRY: registry };

    expect(runHook(code, edit(code, "docs/tasks/T-260902-jxe-slug.md"), env)).toBe("");
    expect(runHook(code, edit(code, "src/app/page.tsx"), env)).toContain("No claimed task");
    // Once said, not repeated on the next edit.
    expect(runHook(code, edit(code, "src/app/other.tsx"), env)).toBe("");
  });

  it("is silent behind an armed marker, and speaks again when the task closes on main", () => {
    const { registry, code } = fixture([{ id: "T-260902-jxe", status: "in-progress" }]);
    const env = { ORBIT_TASKS_REGISTRY: registry };
    fs.writeFileSync(path.join(code, ".git", "current-task"), "T-260902-jxe\n");

    expect(runHook(code, edit(code, "src/app/page.tsx"), env)).toBe("");

    fs.writeFileSync(
      path.join(registry, "docs", "tasks", "T-260902-jxe-slug.md"),
      "---\nid: T-260902-jxe\ntitle: Slug\nstatus: done\nowner: t@example.com\n---\n\n# Slug\n",
    );
    git(registry, "commit", "-q", "-am", "T-260902-jxe: done");
    git(registry, "push", "-q", "origin", "main");
    // The fetch stamp is fresh, so the hook still reads the snapshot; clear it to make it look.
    fs.rmSync(path.join(code, ".git", "task-claim-hook-fetched"), { force: true });

    expect(runHook(code, edit(code, "src/app/page.tsx"), env)).toContain("is done on the registry");
  });

  it("says the gate cannot be satisfied when no registry is reachable", () => {
    const { code } = fixture([]);
    const lonely = fs.mkdtempSync(path.join(os.tmpdir(), "lonely-"));
    temporaries.push(lonely);
    git(lonely, "init", "-q", "-b", "main", ".");
    void code;

    expect(runHook(lonely, edit(lonely, "src/x.ts"), {})).toContain("not reachable");
  });

  it("ignores tools that do not edit files", () => {
    const { registry, code } = fixture([]);

    expect(
      runHook(
        code,
        { tool_name: "Read", tool_input: { file_path: "src/x.ts" } },
        { ORBIT_TASKS_REGISTRY: registry },
      ),
    ).toBe("");
  });

  it("after a shell command, speaks only when the tree now differs outside the registry", () => {
    const { registry, code } = fixture([]);
    const env = { ORBIT_TASKS_REGISTRY: registry };
    const bash = { tool_name: "Bash", tool_input: { command: "whatever ran" } };
    fs.mkdirSync(path.join(code, "docs", "tasks"), { recursive: true });
    fs.writeFileSync(path.join(code, "docs", "tasks", "T-1-x.md"), "registry edit\n");

    // Nothing outside docs/tasks has changed: a command that only recorded stays silent.
    expect(runHook(code, bash, env)).toBe("");
    expect(changedPathsOutsideRegistry(code)).toEqual([]);

    fs.writeFileSync(path.join(code, "src", "x.ts"), "sed -i wrote this\n");
    expect(changedPathsOutsideRegistry(code)).toEqual(["src/x.ts"]);
    expect(runHook(code, bash, env)).toContain("src/x.ts");
  });

  it("sees a shell command that wrote and committed in one go, against the snapshot taken before it", () => {
    const { registry, code } = fixture([]);
    const env = { ORBIT_TASKS_REGISTRY: registry };
    const bash = { tool_name: "Bash", tool_input: { command: "write && git commit" } };
    fs.writeFileSync(path.join(code, "README.md"), "x\n");
    git(code, "add", "-A");
    git(code, "commit", "-q", "-m", "init");

    // Before: the PreToolUse half records HEAD and the (clean) status.
    expect(runHook(code, bash, env, ["--pre"])).toBe("");
    // The command: a file written, staged and committed. The tree ends clean.
    fs.writeFileSync(path.join(code, "src", "generated.ts"), "generated\n");
    git(code, "add", "-A");
    git(code, "commit", "-q", "-m", "generated");
    expect(changedPathsOutsideRegistry(code)).toEqual([]);

    // After: the commit's files are the edit.
    expect(runHook(code, bash, env)).toContain("src/generated.ts");

    // A pre-existing modification is not re-reported by a command that left it alone.
    fs.writeFileSync(path.join(code, "src", "old.ts"), "was already dirty\n");
    const snapshot = writePreSnapshot(code);
    expect(changedPathsOutsideRegistry(code, snapshot)).toEqual([]);
  });

  it("keeps its marker and state inside a linked worktree, where .git is a file", () => {
    const { registry, code } = fixture([{ id: "T-260902-jxe", status: "in-progress" }]);
    fs.writeFileSync(path.join(code, "README.md"), "x\n");
    git(code, "add", "-A");
    git(code, "commit", "-q", "-m", "init");
    const worktree = path.join(path.dirname(code), "orbit-wt");
    git(code, "worktree", "add", "-q", "-b", "feature", worktree);
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
    expect(fs.statSync(path.join(worktree, ".git")).isFile()).toBe(true);

    const marker = gitPath("current-task", worktree);
    expect(marker).not.toBe(path.join(worktree, ".git", "current-task"));
    fs.writeFileSync(marker, "T-260902-jxe\n");

    expect(runHook(worktree, edit(worktree, "src/x.ts"), { ORBIT_TASKS_REGISTRY: registry })).toBe(
      "",
    );
    // The main checkout has no marker of its own, so the same edit there is unclaimed.
    expect(runHook(code, edit(code, "src/x.ts"), { ORBIT_TASKS_REGISTRY: registry })).toContain(
      "No claimed task",
    );
  });

  it("is registered beside the size hook on every file edit", () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(ORBIT_ROOT, ".claude", "settings.json"), "utf8"),
    ) as { hooks: { PostToolUse: { matcher: string; hooks: { command: string }[] }[] } };
    const entry = settings.hooks.PostToolUse.find((e) =>
      e.hooks.some((h) => h.command.includes("task-claim-hook.cjs")),
    );

    expect(entry?.matcher).toBe("Edit|Write|NotebookEdit");
    // And after shell commands, which are the other way a file changes.
    const shell = settings.hooks.PostToolUse.find(
      (e) => e.matcher === "Bash" && e.hooks.some((h) => h.command.includes("task-claim-hook.cjs")),
    );
    expect(shell).toBeDefined();
    // With the snapshot before it, so a command that commits is compared against where it started.
    const pre = (
      settings as unknown as { hooks: { PreToolUse: typeof settings.hooks.PostToolUse } }
    ).hooks.PreToolUse.find(
      (e) => e.matcher === "Bash" && e.hooks.some((h) => h.command.includes("--pre")),
    );
    expect(pre).toBeDefined();
  });
});
