import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { collectFiles, diffTrees } = require("./sync-agent-skills.cjs") as {
  collectFiles: (dir: string) => Map<string, string>;
  diffTrees: (
    source: Map<string, string>,
    target: Map<string, string>,
  ) => { toCopy: string[]; toDelete: string[] };
};

let root: string;

function write(relative: string, contents: string) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
}

function diff() {
  return diffTrees(
    collectFiles(path.join(root, "source")),
    collectFiles(path.join(root, "target")),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-sync-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("collectFiles", () => {
  it("walks nested directories and keys files by POSIX relative path", () => {
    write("source/a/SKILL.md", "a");
    write("source/a/references/deep/note.md", "b");

    expect([...collectFiles(path.join(root, "source")).keys()]).toEqual([
      "a/SKILL.md",
      "a/references/deep/note.md",
    ]);
  });

  it("returns an empty map for a directory that does not exist", () => {
    expect(collectFiles(path.join(root, "missing")).size).toBe(0);
  });
});

describe("diffTrees", () => {
  it("reports nothing to do when the trees match", () => {
    write("source/a/SKILL.md", "same");
    write("target/a/SKILL.md", "same");

    expect(diff()).toEqual({ toCopy: [], toDelete: [] });
  });

  it("reports a skill missing from the target, including its reference files", () => {
    write("source/a/SKILL.md", "a");
    write("source/a/references/guide.md", "g");

    expect(diff()).toEqual({ toCopy: ["a/SKILL.md", "a/references/guide.md"], toDelete: [] });
  });

  it("reports a file whose contents drifted", () => {
    write("source/a/SKILL.md", "new");
    write("target/a/SKILL.md", "old");

    expect(diff()).toEqual({ toCopy: ["a/SKILL.md"], toDelete: [] });
  });

  it("reports a target file with no counterpart in source", () => {
    write("source/a/SKILL.md", "a");
    write("target/a/SKILL.md", "a");
    write("target/removed/SKILL.md", "stale");

    expect(diff()).toEqual({ toCopy: [], toDelete: ["removed/SKILL.md"] });
  });

  it("treats a subdirectory present only in source as work to do", () => {
    write("source/a/SKILL.md", "a");
    write("source/a/agents/openai.yaml", "y");
    write("target/a/SKILL.md", "a");

    expect(diff()).toEqual({ toCopy: ["a/agents/openai.yaml"], toDelete: [] });
  });
});
