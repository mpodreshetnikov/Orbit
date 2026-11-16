import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkClaimedTaskWithWaive,
  checkTaskFileWithWaive,
  parseSpecApprovalsEnv,
} from "./spec-approve-gate.cjs";

const maxim = "mpodreshetnikov@gmail.com";

const complexHeader = `---
id: T-gate-test
depth: execplan
owner: ${maxim}
---

# Gate test
`;

describe("checkTaskFileWithWaive", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeTask(body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-"));
    dirs.push(dir);
    const file = path.join(dir, "task.md");
    fs.writeFileSync(file, body, "utf8");
    return file;
  }

  it("passes when the owner waived Spec on a complex task", () => {
    const file = writeTask(`${complexHeader}\nSpec waived by mpodreshetnikov.\n`);
    const result = checkTaskFileWithWaive(file);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("waived");
  });

  it("still refuses a complex task without Spec, waive, or second approve", () => {
    const file = writeTask(`${complexHeader}\nNo waive.\n`);
    const result = checkTaskFileWithWaive(file);
    expect(result.ok).toBe(false);
    expect(["no-spec", "no-second-approve"]).toContain(result.code);
  });

  it("honours SPEC_APPROVALS for a complex task with a Spec section", () => {
    const file = writeTask(`${complexHeader}\n## Spec\n\nDone.\n`);
    const result = checkTaskFileWithWaive(file, {
      env: { ...process.env, SPEC_APPROVALS: "Kot-kAkos" },
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("approved");
  });

  it("trims and drops empty SPEC_APPROVALS entries", () => {
    const file = writeTask(`${complexHeader}\n## Spec\n\nDone.\n`);
    const result = checkTaskFileWithWaive(file, {
      env: { ...process.env, SPEC_APPROVALS: "  Kot-kAkos  ,  , " },
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("approved");
  });

  it("passes a simple task without needing Spec or waive", () => {
    const file = writeTask(`---
id: T-simple
depth: note
owner: ${maxim}
---

# Simple
`);
    const result = checkTaskFileWithWaive(file);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("simple");
  });
});

describe("checkClaimedTaskWithWaive", () => {
  it("returns no-marker when nothing is claimed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-root-"));
    try {
      const result = checkClaimedTaskWithWaive({
        repoRoot: dir,
        env: { ...process.env },
      });
      expect(result.ok).toBe(true);
      expect(result.code).toBe("no-marker");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies owner waive for a claimed complex task", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-claim-"));
    const registry = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-reg-"));
    try {
      fs.mkdirSync(path.join(root, ".git"), { recursive: true });
      fs.writeFileSync(path.join(root, ".git", "current-task"), "T-gate-waive\n");
      const tasksDir = path.join(registry, "docs", "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, "T-gate-waive-demo.md"),
        `${complexHeader}\nSpec waived by mpodreshetnikov.\n`,
      );
      const result = checkClaimedTaskWithWaive({
        repoRoot: root,
        env: { ...process.env, ORBIT_TASKS_ROOT: registry },
      });
      expect(result.ok).toBe(true);
      expect(result.code).toBe("waived");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(registry, { recursive: true, force: true });
    }
  });

  it("refuses when a claim exists but the registry is unreachable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-noreg-"));
    try {
      fs.mkdirSync(path.join(root, ".git"), { recursive: true });
      fs.writeFileSync(path.join(root, ".git", "current-task"), "T-missing-reg\n");
      const result = checkClaimedTaskWithWaive({
        repoRoot: root,
        env: {
          ...process.env,
          ORBIT_TASKS_ROOT: "",
          ORBIT_TASKS_REGISTRY: "",
        },
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("no-registry");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses when the claimed task file is missing from the registry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-nofile-"));
    const registry = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-emptyreg-"));
    try {
      fs.mkdirSync(path.join(root, ".git"), { recursive: true });
      fs.writeFileSync(path.join(root, ".git", "current-task"), "T-absent\n");
      fs.mkdirSync(path.join(registry, "docs", "tasks"), { recursive: true });
      const result = checkClaimedTaskWithWaive({
        repoRoot: root,
        env: { ...process.env, ORBIT_TASKS_ROOT: registry },
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("unknown-task");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(registry, { recursive: true, force: true });
    }
  });
});

describe("parseSpecApprovalsEnv", () => {
  it("returns an empty list when unset", () => {
    expect(parseSpecApprovalsEnv({})).toEqual([]);
  });

  it("trims entries and drops empties", () => {
    expect(parseSpecApprovalsEnv({ SPEC_APPROVALS: "  Kot-kAkos , ,Maxim " })).toEqual([
      { login: "Kot-kAkos" },
      { login: "Maxim" },
    ]);
  });
});
