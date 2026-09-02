import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as hook from "./caveman-hook.cjs";

const { shouldActivate } = hook;

const HOOK_PATH = path.join(__dirname, "caveman-hook.cjs");

function runHook(payload: string) {
  return spawnSync(process.execPath, [HOOK_PATH], { input: payload, encoding: "utf8" });
}

describe("which session starts turn caveman mode on", () => {
  it("activates on a newly opened session", () => {
    expect(shouldActivate(JSON.stringify({ source: "startup" }))).toBe(true);
  });

  it("activates on /clear, which starts the conversation over", () => {
    expect(shouldActivate(JSON.stringify({ source: "clear" }))).toBe(true);
  });

  it("stays out of a resumed session, where the user's own level choice still stands", () => {
    expect(shouldActivate(JSON.stringify({ source: "resume" }))).toBe(false);
  });

  it("stays out of a compaction, so a long session does not silently undo /caveman off", () => {
    expect(shouldActivate(JSON.stringify({ source: "compact" }))).toBe(false);
  });

  it("activates when the payload says nothing readable, rather than losing the mode", () => {
    expect(shouldActivate("")).toBe(true);
    expect(shouldActivate("not json")).toBe(true);
    expect(shouldActivate(JSON.stringify({ session_id: "x" }))).toBe(true);
  });
});

describe("what the hook writes to stdout", () => {
  it("emits SessionStart context naming the caveman skill and its level", () => {
    const result = runHook(JSON.stringify({ source: "startup" }));

    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout);
    expect(payload.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(payload.hookSpecificOutput.additionalContext).toContain("caveman");
    expect(payload.hookSpecificOutput.additionalContext).toContain("full");
  });

  it("writes nothing at all on a skipped source", () => {
    const result = runHook(JSON.stringify({ source: "compact" }));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
