import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_SCHEDULE,
  normalizeAutoSchedule,
  scheduleDueAtMs,
  type AutoSchedule,
} from "./auto-schedule";
import { describeAutoRunEligibility, nextAutoRunState } from "./auto-run-policy";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Local time, as the schedule reads it. 2026-10-14 is a Wednesday. */
const at = (day: number, hour = 10, month = 9) => new Date(2026, month, day, hour).getTime();

describe("normalizeAutoSchedule", () => {
  it("keeps what is well formed and bounds the day count", () => {
    expect(normalizeAutoSchedule({ kind: "days", every: 3 })).toEqual({ kind: "days", every: 3 });
    expect(normalizeAutoSchedule({ kind: "days", every: 0 })).toEqual({ kind: "days", every: 1 });
    expect(normalizeAutoSchedule({ kind: "days", every: 2.6 })).toEqual({ kind: "days", every: 3 });
    expect(normalizeAutoSchedule({ kind: "month", at: "end" })).toEqual({
      kind: "month",
      at: "end",
    });
  });

  it("reads anything else as the daily default", () => {
    for (const value of [null, "weekly", { kind: "days" }, { kind: "week", at: "noon" }, {}]) {
      expect(normalizeAutoSchedule(value)).toEqual(DEFAULT_AUTO_SCHEDULE);
    }
  });
});

describe("scheduleDueAtMs", () => {
  it("is due at once when nothing has been imported", () => {
    expect(scheduleDueAtMs({ kind: "week", at: "start" }, null)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("waits N days less four hours of slack", () => {
    expect(scheduleDueAtMs({ kind: "days", every: 1 }, at(14))).toBe(at(14) + 20 * HOUR);
    expect(scheduleDueAtMs({ kind: "days", every: 3 }, at(14))).toBe(at(14) + 3 * DAY - 4 * HOUR);
  });

  it.each<[AutoSchedule, number, number]>([
    // A Wednesday import waits for next Monday, or for this Sunday.
    [{ kind: "week", at: "start" }, at(14), at(19, 0)],
    [{ kind: "week", at: "end" }, at(14), at(18, 0)],
    // An import on the anchor day itself covers it: the next is a week on.
    [{ kind: "week", at: "start" }, at(19), at(26, 0)],
    [{ kind: "week", at: "end" }, at(18), at(25, 0)],
    // Months: the first, or the last day whatever the month's length.
    [{ kind: "month", at: "start" }, at(14), at(1, 0, 10)],
    [{ kind: "month", at: "end" }, at(14), at(31, 0)],
    [{ kind: "month", at: "end" }, at(31), at(30, 0, 10)],
    [{ kind: "month", at: "start" }, at(1), at(1, 0, 10)],
    [{ kind: "month", at: "end" }, at(3, 10, 1), at(28, 0, 1)],
  ])("%o after %d is due at %d", (schedule, lastOk, expected) => {
    expect(scheduleDueAtMs(schedule, lastOk)).toBe(expected);
  });
});

describe("eligibility on a schedule", () => {
  const weekly = { schedule: { kind: "week", at: "start" } as AutoSchedule };

  it("holds a success until the next anchor, then lets the sweep run", () => {
    const state = nextAutoRunState(null, at(14), "ok");
    expect(describeAutoRunEligibility(state, at(17), weekly)).toEqual({
      kind: "after",
      atMs: at(19, 0),
    });
    expect(describeAutoRunEligibility(state, at(19, 1), weekly)).toEqual({ kind: "now" });
  });

  it("keeps the failure backoff on top of a schedule that is due", () => {
    const ok = nextAutoRunState(null, at(7), "ok");
    const failed = nextAutoRunState(ok, at(19, 1), "error", "signed out");
    // Due since Monday, but the failure an hour ago still waits its twenty hours.
    expect(describeAutoRunEligibility(failed, at(19, 2), weekly)).toEqual({
      kind: "after",
      atMs: at(19, 1) + 20 * HOUR,
    });
  });
});
