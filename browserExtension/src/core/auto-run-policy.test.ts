import { describe, expect, it } from "vitest";
import {
  createInitialAutoRunState,
  DEFAULT_AUTO_RUN_COOLDOWN_MS,
  describeAutoRunEligibility,
  nextAutoRunState,
  shouldAutoRun,
} from "./auto-run-policy";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

describe("shouldAutoRun", () => {
  it("runs when nothing has run yet", () => {
    expect(shouldAutoRun(null, NOW)).toBe(true);
    expect(shouldAutoRun(createInitialAutoRunState(), NOW)).toBe(true);
  });

  it("stays quiet until the cooldown has passed", () => {
    const state = { lastRunAtMs: NOW - 60_000, lastResult: "ok" as const, consecutiveFailures: 0 };
    expect(shouldAutoRun(state, NOW)).toBe(false);
    expect(shouldAutoRun(state, NOW + DEFAULT_AUTO_RUN_COOLDOWN_MS)).toBe(true);
  });

  it("widens the gap after a failure", () => {
    const oneFailure = {
      lastRunAtMs: NOW - DEFAULT_AUTO_RUN_COOLDOWN_MS,
      lastResult: "error" as const,
      consecutiveFailures: 1,
    };
    expect(shouldAutoRun(oneFailure, NOW)).toBe(true);

    const twoFailures = { ...oneFailure, consecutiveFailures: 2 };
    expect(shouldAutoRun(twoFailures, NOW)).toBe(false);
    expect(shouldAutoRun(twoFailures, NOW + DEFAULT_AUTO_RUN_COOLDOWN_MS)).toBe(true);
  });

  it("stops after three failures in a row", () => {
    // Someone signed out of the bank should not generate a failed attempt on every visit.
    const state = {
      lastRunAtMs: NOW - 30 * DEFAULT_AUTO_RUN_COOLDOWN_MS,
      lastResult: "error" as const,
      consecutiveFailures: 3,
    };
    expect(shouldAutoRun(state, NOW)).toBe(false);
  });

  it("resumes once a run succeeds again", () => {
    const stalled = {
      lastRunAtMs: NOW - 30 * DEFAULT_AUTO_RUN_COOLDOWN_MS,
      lastResult: "error" as const,
      consecutiveFailures: 3,
    };
    const recovered = nextAutoRunState(stalled, NOW, "ok");
    expect(recovered.consecutiveFailures).toBe(0);
    expect(shouldAutoRun(recovered, NOW + DEFAULT_AUTO_RUN_COOLDOWN_MS)).toBe(true);
  });
});

describe("nextAutoRunState", () => {
  it("counts consecutive failures and clears them on success", () => {
    let state = nextAutoRunState(null, NOW, "error");
    expect(state).toEqual({
      lastRunAtMs: NOW,
      lastResult: "error",
      consecutiveFailures: 1,
      lastError: null,
      lastRunOrigin: "auto",
    });

    state = nextAutoRunState(state, NOW + 1, "error");
    expect(state.consecutiveFailures).toBe(2);

    state = nextAutoRunState(state, NOW + 2, "ok");
    expect(state).toEqual({
      lastRunAtMs: NOW + 2,
      lastResult: "ok",
      consecutiveFailures: 0,
      lastError: null,
      lastRunOrigin: "auto",
    });
  });
});

describe("describeAutoRunEligibility", () => {
  // The import page shows this; it must say what shouldAutoRun will decide.
  it("agrees with shouldAutoRun in every state", () => {
    const cases = [
      null,
      createInitialAutoRunState(),
      { lastRunAtMs: NOW - 60_000, lastResult: "ok" as const, consecutiveFailures: 0 },
      { lastRunAtMs: NOW - 60_000, lastResult: "error" as const, consecutiveFailures: 1 },
      { lastRunAtMs: NOW - 60_000, lastResult: "error" as const, consecutiveFailures: 3 },
    ];
    for (const state of cases) {
      for (const at of [
        NOW,
        NOW + DEFAULT_AUTO_RUN_COOLDOWN_MS,
        NOW + 10 * DEFAULT_AUTO_RUN_COOLDOWN_MS,
      ]) {
        const eligibilityAt = describeAutoRunEligibility(state, at);
        expect(shouldAutoRun(state, at)).toBe(eligibilityAt.kind === "now");
        // "after" is only ever a moment still ahead.
        if (eligibilityAt.kind === "after") expect(eligibilityAt.atMs).toBeGreaterThan(at);
      }
    }
  });

  it("names the moment a failed run may be retried", () => {
    const twoFailures = { lastRunAtMs: NOW, lastResult: "error" as const, consecutiveFailures: 2 };
    expect(describeAutoRunEligibility(twoFailures, NOW)).toEqual({
      kind: "after",
      atMs: NOW + 2 * DEFAULT_AUTO_RUN_COOLDOWN_MS,
    });
    // Once that moment has passed it is "now", not a receding timestamp.
    expect(describeAutoRunEligibility(twoFailures, NOW + 2 * DEFAULT_AUTO_RUN_COOLDOWN_MS)).toEqual(
      { kind: "now" },
    );
  });
});

describe("nextAutoRunState", () => {
  it("keeps what the failed attempt said, and drops it on success", () => {
    const failed = nextAutoRunState(
      null,
      NOW,
      "error",
      "T-Bank did not stay on the operations page",
    );
    expect(failed.lastError).toBe("T-Bank did not stay on the operations page");
    // A failure without a message keeps the previous one rather than forgetting it.
    expect(nextAutoRunState(failed, NOW + 1, "error").lastError).toBe(failed.lastError);
    expect(nextAutoRunState(failed, NOW + 2, "ok").lastError).toBeNull();
  });

  it("remembers who started the run", () => {
    expect(nextAutoRunState(null, NOW, "ok", null, "manual").lastRunOrigin).toBe("manual");
    expect(nextAutoRunState(null, NOW, "ok").lastRunOrigin).toBe("auto");
  });
});
