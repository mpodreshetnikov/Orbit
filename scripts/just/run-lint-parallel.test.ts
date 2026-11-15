import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LINT_RECIPES,
  resolveJustBin,
  resolveParallelism,
  runLintParallel,
  runRecipe,
} from "./run-lint-parallel.cjs";

describe("run-lint-parallel", () => {
  it("includes the architecture boundary lane in the parallel set", () => {
    // Independent oracle: justfile recipe id from T-261115-csy / architecture-boundary-lint.md
    expect(LINT_RECIPES).toContain("quality-lint-boundaries");
    expect(LINT_RECIPES).toEqual([
      "quality-lint-web",
      "quality-lint-extension",
      "quality-lint-scripts",
      "quality-lint-supabase-functions",
      "quality-lint-boundaries",
      "test-smell-lint",
    ]);
    expect(LINT_RECIPES).toHaveLength(6);
  });

  it("resolveParallelism prefers a positive LINT_PARALLELISM cap", () => {
    expect(resolveParallelism({ LINT_PARALLELISM: "2" }, "linux", 6)).toBe(2);
    expect(resolveParallelism({ LINT_PARALLELISM: "99" }, "linux", 6)).toBe(6);
    expect(resolveParallelism({ LINT_PARALLELISM: "0" }, "linux", 6)).toBe(6);
    expect(resolveParallelism({ LINT_PARALLELISM: "nope" }, "linux", 6)).toBe(6);
    expect(resolveParallelism({}, "linux", 6)).toBe(6);
  });

  it("resolveParallelism forces one worker on Windows when unset", () => {
    expect(resolveParallelism({}, "win32", 6)).toBe(1);
    expect(resolveParallelism({}, "linux", 6)).toBe(6);
    expect(resolveParallelism({ LINT_PARALLELISM: "3" }, "win32", 6)).toBe(3);
  });

  it("resolveJustBin uses JUST_BIN, then WinGet just.exe when present, else just", () => {
    const local = "C:\\Users\\x\\AppData\\Local";
    const winget = path.join(local, "Microsoft", "WinGet", "Links", "just.exe");
    expect(resolveJustBin({ JUST_BIN: "/custom/just" }, "linux")).toBe("/custom/just");

    // Linux must ignore WinGet even if existsSync would say yes (kills `if (platform===win32)` → true).
    const existsAlways = vi.fn(() => true);
    expect(resolveJustBin({ LOCALAPPDATA: local }, "linux", existsAlways)).toBe("just");
    expect(existsAlways).not.toHaveBeenCalled();

    expect(resolveJustBin({ LOCALAPPDATA: local }, "win32", (p) => p === winget)).toBe(winget);
    expect(resolveJustBin({ LOCALAPPDATA: local }, "win32", () => false)).toBe("just");
    expect(resolveJustBin({}, "win32", () => true)).toBe("just");
    expect(resolveJustBin({}, "linux")).toBe("just");
  });

  it("runRecipe returns the child exit code and maps null/undefined/error to 1", async () => {
    const env = { MARKER: "orbit-lint" };
    async function closeWith(code: number | null | undefined) {
      const child = new EventEmitter();
      const spawnFn = vi.fn(() => {
        queueMicrotask(() => child.emit("close", code));
        return child;
      });
      const result = await runRecipe("quality-lint-boundaries", {
        spawnFn: spawnFn as never,
        justBin: "/bin/just",
        env,
      });
      expect(spawnFn).toHaveBeenCalledWith("/bin/just", ["quality-lint-boundaries"], {
        stdio: "inherit",
        env,
      });
      return result;
    }

    await expect(closeWith(0)).resolves.toBe(0);
    await expect(closeWith(5)).resolves.toBe(5);
    await expect(closeWith(null)).resolves.toBe(1);
    await expect(closeWith(undefined)).resolves.toBe(1);

    const fail = new EventEmitter();
    const spawnFail = vi.fn(() => {
      queueMicrotask(() => fail.emit("error", new Error("enoent")));
      return fail;
    });
    await expect(
      runRecipe("quality-lint-web", { spawnFn: spawnFail as never, justBin: "just" }),
    ).resolves.toBe(1);
  });

  it("runLintParallel returns the first failing recipe exit code", async () => {
    const runOne = vi.fn(async (recipe: string) => (recipe === "quality-lint-boundaries" ? 7 : 0));
    const captureResults: number[] = [];
    const code = await runLintParallel({
      recipes: ["quality-lint-web", "quality-lint-boundaries", "test-smell-lint"],
      parallelism: 1,
      runOne,
      captureResults,
    });
    expect(code).toBe(7);
    // Unrun slots stay numeric 0 (kills map(() => undefined)).
    expect(captureResults).toEqual([0, 7, 0]);
    expect(runOne.mock.calls.map((c) => c[0])).toEqual([
      "quality-lint-web",
      "quality-lint-boundaries",
    ]);
  });

  it("runLintParallel returns 0 when every recipe succeeds", async () => {
    const runOne = vi.fn(async () => 0);
    const captureResults: number[] = [];
    await expect(
      runLintParallel({
        recipes: ["quality-lint-boundaries", "test-smell-lint"],
        parallelism: 2,
        runOne,
        captureResults,
      }),
    ).resolves.toBe(0);
    expect(runOne).toHaveBeenCalledTimes(2);
    expect(captureResults).toEqual([0, 0]);
  });

  it("runLintParallel works without captureResults (optional sink)", async () => {
    // Kills `if (captureResults)` → true, which would throw on undefined.push.
    await expect(
      runLintParallel({
        recipes: ["quality-lint-boundaries"],
        parallelism: 1,
        runOne: async () => 0,
      }),
    ).resolves.toBe(0);
  });
});
