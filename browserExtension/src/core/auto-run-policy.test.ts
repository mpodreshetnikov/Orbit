import { describe, expect, it } from "vitest";
import {
  createInitialAutoRunState,
  DEFAULT_AUTO_RUN_COOLDOWN_MS,
  nextAutoRunState,
  pickAutoRunTab,
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
    expect(state).toEqual({ lastRunAtMs: NOW, lastResult: "error", consecutiveFailures: 1 });

    state = nextAutoRunState(state, NOW + 1, "error");
    expect(state.consecutiveFailures).toBe(2);

    state = nextAutoRunState(state, NOW + 2, "ok");
    expect(state).toEqual({ lastRunAtMs: NOW + 2, lastResult: "ok", consecutiveFailures: 0 });
  });
});

describe("pickAutoRunTab", () => {
  const matches = (url: string | undefined) => Boolean(url?.includes("tbank.ru"));

  it("prefers a bank tab that has finished loading", () => {
    const picked = pickAutoRunTab(
      [
        { id: 1, url: "https://example.com/", status: "complete" },
        { id: 2, url: "https://www.tbank.ru/mybank/", status: "loading" },
        { id: 3, url: "https://www.tbank.ru/mybank/operations/", status: "complete" },
      ],
      matches,
    );
    expect(picked?.id).toBe(3);
  });

  it("falls back to a loading bank tab", () => {
    const picked = pickAutoRunTab(
      [{ id: 2, url: "https://www.tbank.ru/mybank/", status: "loading" }],
      matches,
    );
    expect(picked?.id).toBe(2);
  });

  it("returns nothing when no bank tab is open", () => {
    expect(pickAutoRunTab([{ id: 1, url: "https://example.com/" }], matches)).toBeNull();
    expect(pickAutoRunTab([{ url: "https://www.tbank.ru/" }], matches)).toBeNull();
  });
});
