import { describe, expect, it } from "vitest";
import {
  ATTENTION_PAGE_MIN_INTERVAL_MS,
  DAY_MS,
  DEFAULT_STALE_AFTER_MS,
  HOUR_MS,
  MAX_STALE_AFTER_MS,
  MIN_STALE_AFTER_MS,
  RUN_REQUEST_TTL_MS,
  describeSourceFreshness,
  isRunRequestLive,
  normalizeStaleAfterMs,
  shouldOpenAttentionPage,
} from "./attention-policy";
import { nextAutoRunState } from "./auto-run-policy";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const GRANT_AT = NOW - 3 * DAY_MS;

describe("normalizeStaleAfterMs", () => {
  it("defaults to a day and keeps a threshold inside its bounds", () => {
    expect(normalizeStaleAfterMs(undefined)).toBe(DEFAULT_STALE_AFTER_MS);
    expect(normalizeStaleAfterMs("2")).toBe(DEFAULT_STALE_AFTER_MS);
    expect(normalizeStaleAfterMs(Number.NaN)).toBe(DEFAULT_STALE_AFTER_MS);
    expect(normalizeStaleAfterMs(0)).toBe(MIN_STALE_AFTER_MS);
    expect(normalizeStaleAfterMs(400 * DAY_MS)).toBe(MAX_STALE_AFTER_MS);
    expect(normalizeStaleAfterMs(3 * DAY_MS)).toBe(3 * DAY_MS);
  });
});

describe("describeSourceFreshness", () => {
  it("measures from the last successful run, not the last attempt", () => {
    // Success two days ago, then a failure an hour ago: the data is two days old.
    let state = nextAutoRunState(null, NOW - 2 * DAY_MS, "ok");
    state = nextAutoRunState(state, NOW - HOUR_MS, "error", "signed out");
    const freshness = describeSourceFreshness(state, GRANT_AT, NOW, DAY_MS);
    expect(freshness.lastOkAtMs).toBe(NOW - 2 * DAY_MS);
    expect(freshness.staleForMs).toBe(2 * DAY_MS);
    expect(freshness.stale).toBe(true);
  });

  it("counts a fresh success as fresh", () => {
    const state = nextAutoRunState(null, NOW - 2 * HOUR_MS, "ok");
    expect(describeSourceFreshness(state, GRANT_AT, NOW, DAY_MS).stale).toBe(false);
  });

  it("counts from the grant's arrival before any success, so a new key is not stale on the spot", () => {
    const fresh = describeSourceFreshness(null, NOW - HOUR_MS, NOW, DAY_MS);
    expect(fresh.lastOkAtMs).toBeNull();
    expect(fresh.sinceMs).toBe(NOW - HOUR_MS);
    expect(fresh.stale).toBe(false);

    const old = describeSourceFreshness(null, GRANT_AT, NOW, DAY_MS);
    expect(old.stale).toBe(true);
    expect(old.staleForMs).toBe(3 * DAY_MS);
  });

  it("reads a state written before lastOkAtMs existed", () => {
    const legacyOk = {
      lastRunAtMs: NOW - 2 * DAY_MS,
      lastResult: "ok" as const,
      consecutiveFailures: 0,
    };
    expect(describeSourceFreshness(legacyOk, GRANT_AT, NOW, DAY_MS).lastOkAtMs).toBe(
      NOW - 2 * DAY_MS,
    );
    // A legacy failure has lost its last success; the grant's arrival stands in.
    const legacyError = {
      lastRunAtMs: NOW - HOUR_MS,
      lastResult: "error" as const,
      consecutiveFailures: 1,
    };
    expect(describeSourceFreshness(legacyError, GRANT_AT, NOW, DAY_MS).sinceMs).toBe(GRANT_AT);
  });
});

describe("shouldOpenAttentionPage", () => {
  it("opens for a stale source once, then not again for a day", () => {
    expect(shouldOpenAttentionPage({ staleCount: 1, lastOpenedAtMs: null, nowMs: NOW })).toBe(true);
    expect(
      shouldOpenAttentionPage({ staleCount: 1, lastOpenedAtMs: NOW - HOUR_MS, nowMs: NOW }),
    ).toBe(false);
    expect(
      shouldOpenAttentionPage({
        staleCount: 1,
        lastOpenedAtMs: NOW - ATTENTION_PAGE_MIN_INTERVAL_MS,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("never opens when nothing is stale", () => {
    expect(shouldOpenAttentionPage({ staleCount: 0, lastOpenedAtMs: null, nowMs: NOW })).toBe(
      false,
    );
  });
});

describe("isRunRequestLive", () => {
  it("honours a request for an hour and forgets it after", () => {
    expect(isRunRequestLive(NOW - 10 * 60 * 1000, NOW)).toBe(true);
    expect(isRunRequestLive(NOW - RUN_REQUEST_TTL_MS, NOW)).toBe(false);
    expect(isRunRequestLive(undefined, NOW)).toBe(false);
    expect(isRunRequestLive("yesterday", NOW)).toBe(false);
  });
});
