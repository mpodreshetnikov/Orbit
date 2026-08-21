import { describe, expect, it } from "vitest";
import {
  localDateTimeUtc,
  localDayEndUtc,
  localDayStartUtc,
  timezoneOffsetMinutes,
} from "./local-day";

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

describe("localDateTimeUtc", () => {
  it("reads a wall-clock time in the named zone, not the server's", () => {
    // The server runs in UTC; treating this as UTC would file it 7 hours late
    // and, at 23:10, on the wrong local day.
    expect(localDateTimeUtc("2026-08-19T23:10", "Asia/Bangkok")).toBe("2026-08-19T16:10:00.000Z");
  });

  it("accepts seconds, milliseconds and a space separator", () => {
    expect(localDateTimeUtc("2026-08-19 23:10:30", "Asia/Bangkok")).toBe(
      "2026-08-19T16:10:30.000Z",
    );
    expect(localDateTimeUtc("2026-08-19T23:10:30.500", "UTC")).toBe("2026-08-19T23:10:30.500Z");
  });

  it("settles the offset across a DST boundary", () => {
    // Berlin is UTC+1 in January and UTC+2 in July.
    expect(localDateTimeUtc("2026-01-15T12:00", "Europe/Berlin")).toBe("2026-01-15T11:00:00.000Z");
    expect(localDateTimeUtc("2026-07-15T12:00", "Europe/Berlin")).toBe("2026-07-15T10:00:00.000Z");
  });

  it("rejects anything that is not a zone-less date and time", () => {
    // `new Date` would accept every one of these and invent an instant.
    expect(localDateTimeUtc("0", "UTC")).toBeNull();
    expect(localDateTimeUtc("2026-08-19", "UTC")).toBeNull();
    expect(localDateTimeUtc("yesterday evening", "UTC")).toBeNull();
    expect(localDateTimeUtc("2026-08-19T23:10:00+07:00", "UTC")).toBeNull();
  });

  it("rejects a calendar date that does not exist", () => {
    // `Date.parse` rolls these forward instead of failing, which would file the
    // intake on a day the caller never named.
    expect(localDateTimeUtc("2026-02-30T12:00", "UTC")).toBeNull();
    expect(localDateTimeUtc("2026-04-31T12:00", "Asia/Bangkok")).toBeNull();
    expect(localDateTimeUtc("2026-13-01T12:00", "UTC")).toBeNull();
    // 2028 is a leap year, so this one is real and must still pass.
    expect(localDateTimeUtc("2028-02-29T12:00", "UTC")).toBe("2028-02-29T12:00:00.000Z");
  });

  it("rejects a local time that does not exist in the zone", () => {
    // A spring-forward gap has no such wall clock. The iteration still settles
    // on an instant, an hour off -- and where the transition sits at midnight,
    // on the previous local day, which is the failure this whole function
    // exists to prevent.
    expect(localDateTimeUtc("2026-03-29T02:30", "Europe/Berlin")).toBeNull();
    expect(localDateTimeUtc("2026-03-08T02:30", "America/New_York")).toBeNull();
    expect(localDateTimeUtc("2026-09-06T00:30", "America/Santiago")).toBeNull();
    expect(localDateTimeUtc("2026-03-08T00:30", "America/Havana")).toBeNull();
  });

  it("accepts an ambiguous fall-back time, settling on the later occurrence", () => {
    // Berlin falls back on 2026-10-25, so 02:30 happens twice: 00:30Z at UTC+2
    // and 01:30Z at UTC+1. Unlike a gap this wall clock does exist, so refusing
    // it would be unhelpful -- and either reading is at most an hour out, which
    // for "when did she take it" is noise rather than a wrong day. Pinned here
    // so the choice is a decision rather than an accident of the iteration.
    expect(localDateTimeUtc("2026-10-25T02:30", "Europe/Berlin")).toBe("2026-10-25T01:30:00.000Z");
  });

  it("falls back to reading it as UTC when the timezone is unusable", () => {
    expect(localDateTimeUtc("2026-08-19T23:10", "Not/AZone")).toBe("2026-08-19T23:10:00.000Z");
  });
});
