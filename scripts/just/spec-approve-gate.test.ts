import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkClaimedTaskWithWaive, checkTaskFileWithWaive } from "./spec-approve-gate.cjs";

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
});

describe("checkClaimedTaskWithWaive", () => {
  it("returns no-marker when nothing is claimed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-gate-root-"));
    try {
      const result = checkClaimedTaskWithWaive({ repoRoot: dir, env: {} });
      expect(result.ok).toBe(true);
      expect(result.code).toBe("no-marker");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
