import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  changedFiles,
  gitDiffFailedMessage,
  isMutable,
  resolveBase,
  resolveMutate,
  resolveTz,
  runMutation,
  writeSkipReport,
  writeSummaryFromStrykerJson,
} from "./run-mutation.cjs";

describe("isMutable", () => {
  it("accepts Vitest-covered production surfaces", () => {
    expect(isMutable("src/lib/foo.ts")).toBe(true);
    expect(isMutable("scripts/just/participants.cjs")).toBe(true);
    expect(isMutable("browserExtension/bg.ts")).toBe(true);
    expect(isMutable("native/x.ts")).toBe(true);
  });

  it("rejects tests and non-allowlisted trees", () => {
    expect(isMutable("src/lib/foo.test.ts")).toBe(false);
    expect(isMutable("src/lib/foo.spec.tsx")).toBe(false);
    expect(isMutable("supabase/functions/x/service_test.ts")).toBe(false);
    expect(isMutable("supabase/functions/x/service.ts")).toBe(false);
    expect(isMutable("mobile/App.tsx")).toBe(false);
    expect(isMutable("e2e/flow.ts")).toBe(false);
    expect(isMutable("docs/QUALITY.md")).toBe(false);
    expect(isMutable("src/lib/foo")).toBe(false);
    // Extension regex must be end-anchored: `.ts` mid-name is not enough.
    expect(isMutable("src/lib/foo.ts.bak")).toBe(false);
    expect(isMutable("src/lib/foo_test.ts")).toBe(false);
    // Mid-path `_test.ts` / `.test.ts` must not exclude a real production file.
    expect(isMutable("src/x_test.ts/foo.ts")).toBe(true);
    expect(isMutable("src/foo.test.ts/extra.ts")).toBe(true);
  });
});

describe("resolveBase / resolveTz / gitDiffFailedMessage", () => {
  it("prefers opts.base over env", () => {
    expect(resolveBase({ base: "custom" }, { STRYKER_BASE: "from-env" })).toBe("custom");
    expect(resolveBase({}, { STRYKER_BASE: "from-env" })).toBe("from-env");
    expect(resolveBase({}, {})).toBe("origin/main");
  });

  it("defaults TZ when unset", () => {
    expect(resolveTz({ TZ: "UTC" })).toBe("UTC");
    expect(resolveTz({})).toBe("Asia/Krasnoyarsk");
  });

  it("prefers stderr, then stdout, then fallback for git errors", () => {
    expect(gitDiffFailedMessage({ stderr: "fatal", stdout: "out" })).toBe("fatal");
    expect(gitDiffFailedMessage({ stderr: "", stdout: "out" })).toBe("out");
    expect(gitDiffFailedMessage({ stderr: "", stdout: "" })).toBe("git diff failed");
  });
});

describe("changedFiles / resolveMutate", () => {
  it("parses git diff lines and filters mutable files", () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: "src/a.ts\n\n  src/b.ts  \nsrc/a.test.ts\nscripts/just/x.cjs\nmobile/App.tsx\n",
      stderr: "",
    }));
    expect(changedFiles("origin/main", spawn as never)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/a.test.ts",
      "scripts/just/x.cjs",
      "mobile/App.tsx",
    ]);
    expect(resolveMutate("origin/main", spawn as never)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "scripts/just/x.cjs",
    ]);
    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", "origin/main...HEAD"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("throws when git diff fails", () => {
    const spawn = vi.fn(() => ({ status: 2, stdout: "", stderr: "fatal" }));
    expect(() => changedFiles("origin/main", spawn as never)).toThrow(/fatal/);
  });

  it("throws the fallback message when git stderr and stdout are empty", () => {
    const spawn = vi.fn(() => ({ status: 2, stdout: "", stderr: "" }));
    expect(() => changedFiles("origin/main", spawn as never)).toThrow(/git diff failed/);
  });
});

describe("runMutation", () => {
  const summaryPath = path.join(process.cwd(), "reports/mutation/mutation-summary.json");

  it("skips with exit 0 when nothing mutable changed", () => {
    const spawn = vi.fn((cmd: string) => {
      if (cmd === "git") return { status: 0, stdout: "docs/QUALITY.md\n", stderr: "" };
      throw new Error(`unexpected ${cmd}`);
    });
    expect(runMutation({ base: "origin/main", spawn: spawn as never })).toBe(0);
    expect(fs.existsSync(summaryPath)).toBe(true);
    const skip = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    expect(skip.mode).toBe("incremental-skip");
    expect(skip.mutationScoreCovered).toBe(100);
    expect(skip.survived).toBe(0);
    expect(skip.files).toEqual([]);
  });

  it("runs stryker when mutable files exist and returns 0 on success", () => {
    const dir = path.join(process.cwd(), "reports/mutation");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "mutation.json"),
      JSON.stringify({
        files: {
          "a.ts": {
            mutants: [{ status: "Killed" }, { status: "NoCoverage" }, { status: "Timeout" }],
          },
        },
      }),
    );
    const spawn = vi.fn((cmd: string, args?: string[], options?: Record<string, unknown>) => {
      if (cmd === "git") {
        return { status: 0, stdout: "scripts/just/participants.cjs\n", stderr: "" };
      }
      if (cmd === "npx") {
        expect(args).toEqual(["stryker", "run", "--mutate", "scripts/just/participants.cjs"]);
        expect(options).toEqual(
          expect.objectContaining({
            stdio: "inherit",
            env: expect.objectContaining({ TZ: expect.any(String) }),
          }),
        );
        return { status: 0 };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    expect(runMutation({ base: "origin/main", spawn: spawn as never })).toBe(0);
  });

  it("returns numeric non-zero status from stryker runner failure", () => {
    const spawn = vi.fn((cmd: string) => {
      if (cmd === "git") {
        return { status: 0, stdout: "scripts/just/participants.cjs\n", stderr: "" };
      }
      return { status: 3 };
    });
    expect(runMutation({ base: "origin/main", spawn: spawn as never })).toBe(3);
  });

  it("fails the covered gate when the report has survivors", () => {
    const dir = path.join(process.cwd(), "reports/mutation");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "mutation.json"),
      JSON.stringify({
        files: {
          "a.ts": { mutants: [{ status: "Killed" }, { status: "Survived" }] },
        },
      }),
    );
    const spawn = vi.fn((cmd: string) => {
      if (cmd === "git") {
        return { status: 0, stdout: "scripts/just/participants.cjs\n", stderr: "" };
      }
      return { status: 0 };
    });
    expect(runMutation({ base: "origin/main", spawn: spawn as never })).toBe(1);
  });

  it("returns 2 when spawn reports an error object", () => {
    const spawn = vi.fn((cmd: string) => {
      if (cmd === "git") {
        return { status: 0, stdout: "scripts/just/participants.cjs\n", stderr: "" };
      }
      return { error: new Error("enoent"), status: null };
    });
    expect(runMutation({ base: "origin/main", spawn: spawn as never })).toBe(2);
  });

  it("returns 1 when status is null without error", () => {
    const spawn = vi.fn((cmd: string) => {
      if (cmd === "git") {
        return { status: 0, stdout: "scripts/just/participants.cjs\n", stderr: "" };
      }
      return { status: null };
    });
    expect(runMutation({ base: "origin/main", spawn: spawn as never })).toBe(1);
  });

  it("returns 1 when git diff fails inside runMutation", () => {
    const spawn = vi.fn(() => ({ status: 2, stdout: "", stderr: "fatal" }));
    expect(runMutation({ base: "origin/main", spawn: spawn as never })).toBe(1);
  });

  it("writeSkipReport and writeSummaryFromStrykerJson round-trip", () => {
    const skip = writeSkipReport("origin/main");
    expect(skip.files).toEqual([]);
    const dir = path.join(process.cwd(), "reports/mutation");
    const report = {
      files: {
        "a.ts": { mutants: [{ status: "Killed" }, { status: "Survived" }] },
      },
    };
    fs.writeFileSync(path.join(dir, "mutation.json"), JSON.stringify(report));
    const counts = writeSummaryFromStrykerJson();
    expect(counts?.mutationScore).toBe(50);
    expect(counts?.killed).toBe(1);
  });

  it("returns null from writeSummaryFromStrykerJson when the report is missing", () => {
    const fakeFs = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("should not read");
      },
      writeFileSync: () => {
        throw new Error("should not write");
      },
    };
    expect(writeSummaryFromStrykerJson(fakeFs as never)).toBeNull();
  });
});
