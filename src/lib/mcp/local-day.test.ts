import { describe, expect, it } from "vitest";
import { localDayEndUtc, localDayStartUtc, timezoneOffsetMinutes } from "./local-day";

describe("timezoneOffsetMinutes", () => {
  it("is zero for UTC", () => {
    expect(timezoneOffsetMinutes("UTC", new Date("2026-06-15T12:00:00Z"))).toBe(0);
  });

  it("tracks daylight saving", () => {
    // Europe/Berlin is UTC+1 in winter and UTC+2 in summer.
    expect(timezoneOffsetMinutes("Europe/Berlin", new Date("2026-01-15T12:00:00Z"))).toBe(60);
    expect(timezoneOffsetMinutes("Europe/Berlin", new Date("2026-06-15T12:00:00Z"))).toBe(120);
  });

  it("handles zones west of UTC and half-hour offsets", () => {
    expect(timezoneOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(timezoneOffsetMinutes("Asia/Kolkata", new Date("2026-06-15T12:00:00Z"))).toBe(330);
  });
});

describe("localDayStartUtc / localDayEndUtc", () => {
  it("is a plain UTC day for UTC", () => {
    expect(localDayStartUtc("2026-06-15", "UTC")).toBe("2026-06-15T00:00:00.000Z");
    expect(localDayEndUtc("2026-06-15", "UTC")).toBe("2026-06-15T23:59:59.999Z");
  });

  it("shifts the window for a zone east of UTC", () => {
    // Summer in Berlin is UTC+2, so the local day starts at 22:00 the day before.
    expect(localDayStartUtc("2026-06-15", "Europe/Berlin")).toBe("2026-06-14T22:00:00.000Z");
    expect(localDayEndUtc("2026-06-15", "Europe/Berlin")).toBe("2026-06-15T21:59:59.999Z");
  });

  it("shifts the window for a zone west of UTC", () => {
    expect(localDayStartUtc("2026-01-15", "America/New_York")).toBe("2026-01-15T05:00:00.000Z");
  });

  it("includes an early-morning local dose that a naive UTC range would miss", () => {
    // The bug this exists to prevent: a 00:30 Berlin dose on 2026-06-15 is
    // 2026-06-14T22:30Z, which a `2026-06-15T00:00:00Z` lower bound excludes.
    const dose = Date.parse("2026-06-14T22:30:00.000Z");
    const start = Date.parse(localDayStartUtc("2026-06-15", "Europe/Berlin"));
    const end = Date.parse(localDayEndUtc("2026-06-15", "Europe/Berlin"));

    expect(dose).toBeGreaterThanOrEqual(start);
    expect(dose).toBeLessThanOrEqual(end);
    expect(dose).toBeLessThan(Date.parse("2026-06-15T00:00:00.000Z"));
  });

  it("excludes a dose belonging to the next local day", () => {
    // 2026-06-15T22:30Z is 00:30 on the 16th in Berlin.
    const dose = Date.parse("2026-06-15T22:30:00.000Z");
    const end = Date.parse(localDayEndUtc("2026-06-15", "Europe/Berlin"));

    expect(dose).toBeGreaterThan(end);
  });

  it("resolves the DST spring-forward boundary", () => {
    // Berlin springs forward on 2026-03-29; the local day still starts at the
    // pre-transition offset of UTC+1.
    expect(localDayStartUtc("2026-03-29", "Europe/Berlin")).toBe("2026-03-28T23:00:00.000Z");
  });

  it("falls back to a UTC day for an unknown timezone rather than throwing", () => {
    expect(localDayStartUtc("2026-06-15", "Not/AZone")).toBe("2026-06-15T00:00:00.000Z");
    expect(localDayEndUtc("2026-06-15", "Not/AZone")).toBe("2026-06-15T23:59:59.999Z");
  });
});
