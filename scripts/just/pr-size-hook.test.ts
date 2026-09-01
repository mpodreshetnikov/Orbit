import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import * as hook from "./pr-size-hook.cjs";

const { shouldReport, REPORT_STEP } = hook;

function statePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pr-size-hook-")), "pr-size-hook-state");
}

describe("how often the editor hook repeats itself", () => {
  it("reports the first time it has anything to say", () => {
    expect(shouldReport(1200, statePath())).toBe(true);
  });

  it("stays quiet until the branch has grown another step, so the warning keeps being read", () => {
    const state = statePath();

    expect(shouldReport(1200, state)).toBe(true);
    expect(shouldReport(1201, state)).toBe(false);
    expect(shouldReport(1299, state)).toBe(false);
    expect(shouldReport(1200 + REPORT_STEP, state)).toBe(true);
  });

  it("does not report again when the branch shrinks back", () => {
    const state = statePath();

    expect(shouldReport(1400, state)).toBe(true);
    expect(shouldReport(1100, state)).toBe(false);
  });

  it("reports when the state file cannot be read", () => {
    expect(shouldReport(1200, path.join(os.tmpdir(), "no", "such", "dir", "state"))).toBe(true);
  });
});

describe("the hook itself", () => {
  // It runs on every file edit. Anything it does other than print must not reach the session.
  it("exits 0 and emits nothing or one JSON object", () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "pr-size-hook.cjs")], {
      encoding: "utf8",
      cwd: path.resolve(__dirname, "..", ".."),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    if (result.stdout.trim()) {
      expect(JSON.parse(result.stdout).hookSpecificOutput.hookEventName).toBe("PostToolUse");
    }
  });
});
