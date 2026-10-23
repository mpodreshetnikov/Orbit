import { describe, expect, it } from "@jest/globals";
import { localDayBounds, msUntilNextLocalDay } from "@/features/doses/day";

describe("localDayBounds", () => {
  it("starts at local midnight of the day the instant falls in", () => {
    const now = new Date(2026, 9, 18, 14, 37, 12, 500);
    const { startIso } = localDayBounds(now);
    expect(new Date(startIso)).toEqual(new Date(2026, 9, 18, 0, 0, 0, 0));
  });

  it("ends at local midnight of the next day, so the window is half-open", () => {
    const now = new Date(2026, 9, 18, 14, 37);
    const { endIso } = localDayBounds(now);
    expect(new Date(endIso)).toEqual(new Date(2026, 9, 19, 0, 0, 0, 0));
  });

  it("puts a late-evening instant in the day the owner is living in", () => {
    const now = new Date(2026, 9, 18, 23, 30);
    const { startIso, endIso } = localDayBounds(now);
    expect(new Date(startIso).getTime()).toBeLessThanOrEqual(now.getTime());
    expect(new Date(endIso).getTime()).toBeGreaterThan(now.getTime());
  });

  it("puts an instant just after midnight in the new day, not the one just ended", () => {
    const now = new Date(2026, 9, 18, 0, 5);
    const { startIso } = localDayBounds(now);
    expect(new Date(startIso)).toEqual(new Date(2026, 9, 18, 0, 0, 0, 0));
  });

  it("crosses a month boundary without landing in the wrong month", () => {
    const now = new Date(2026, 9, 31, 12, 0);
    const { endIso } = localDayBounds(now);
    expect(new Date(endIso)).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0));
  });

  it("crosses a year boundary", () => {
    const now = new Date(2026, 11, 31, 12, 0);
    const { endIso } = localDayBounds(now);
    expect(new Date(endIso)).toEqual(new Date(2027, 0, 1, 0, 0, 0, 0));
  });

  it("returns a window that contains the instant it was asked about", () => {
    const now = new Date(2026, 1, 28, 9, 15);
    const { startIso, endIso } = localDayBounds(now);
    expect(new Date(startIso).getTime()).toBeLessThanOrEqual(now.getTime());
    expect(new Date(endIso).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("msUntilNextLocalDay", () => {
  it("counts the time left in the local day", () => {
    const now = new Date(2026, 9, 18, 23, 30, 0, 0);
    expect(msUntilNextLocalDay(now)).toBe(30 * 60 * 1000);
  });

  it("is a whole day just after midnight", () => {
    const now = new Date(2026, 9, 18, 0, 0, 0, 0);
    const endOfDay = new Date(2026, 9, 19, 0, 0, 0, 0).getTime();
    expect(msUntilNextLocalDay(now)).toBe(endOfDay - now.getTime());
  });

  it("never returns zero, so a caller cannot schedule a loop at the boundary", () => {
    const midnight = new Date(2026, 9, 19, 0, 0, 0, 0);
    expect(msUntilNextLocalDay(midnight)).toBeGreaterThan(0);
  });

  it("stays positive across a month boundary", () => {
    expect(msUntilNextLocalDay(new Date(2026, 9, 31, 23, 59, 0, 0))).toBe(60 * 1000);
  });
});
