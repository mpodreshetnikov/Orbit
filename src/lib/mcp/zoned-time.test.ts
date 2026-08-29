import { describe, expect, it } from "vitest";
import {
  formatZoned,
  instantFromInput,
  offsetLabel,
  withZonedTimestamps,
  zonedDate,
  zonedIso,
} from "./zoned-time";

/**
 * The case these exist for: a course scheduled for 22:00 in a zone seven hours
 * ahead is stored as 15:00Z. Every assertion below that mentions 22:00 is the
 * defect from T-0027 in miniature — reverting the rendering makes it fail.
 */
const BANGKOK = "Asia/Bangkok"; // UTC+7, no DST
const BERLIN = "Europe/Berlin"; // UTC+1 / +2

describe("offsetLabel", () => {
  it("renders whole and half-hour offsets on both sides of UTC", () => {
    expect(offsetLabel(420)).toBe("+07:00");
    expect(offsetLabel(0)).toBe("+00:00");
    expect(offsetLabel(-210)).toBe("-03:30");
    expect(offsetLabel(345)).toBe("+05:45"); // Kathmandu
  });
});

describe("zonedIso", () => {
  it("converts the stored instant to the wall clock the person keeps", () => {
    expect(zonedIso("2026-08-24T15:00:00+00:00", BANGKOK)).toBe("2026-08-24T22:00:00+07:00");
  });

  it("follows the zone across a daylight-saving change", () => {
    expect(zonedIso("2026-01-15T12:00:00Z", BERLIN)).toBe("2026-01-15T13:00:00+01:00");
    expect(zonedIso("2026-07-15T12:00:00Z", BERLIN)).toBe("2026-07-15T14:00:00+02:00");
  });

  it("renders UTC as an explicit +00:00 rather than a bare reading", () => {
    expect(zonedIso("2026-08-24T15:00:00Z", "UTC")).toBe("2026-08-24T15:00:00+00:00");
  });

  it("falls back to UTC for a zone it does not recognise", () => {
    // The tools refuse an unknown zone at their boundary; this is the last
    // resort, and answering in UTC beats throwing while composing a reply.
    expect(zonedIso("2026-08-24T15:00:00Z", "Mars/Olympus")).toBe("2026-08-24T15:00:00+00:00");
  });

  it("returns null for something that is not a timestamp", () => {
    expect(zonedIso("not a time", BANGKOK)).toBeNull();
  });
});

describe("formatZoned", () => {
  it("is the reading a person recognises, with the offset kept", () => {
    expect(formatZoned("2026-08-24T15:00:00+00:00", BANGKOK)).toBe("2026-08-24 22:00 +07:00");
  });

  it("never renders the UTC clock as if it were local", () => {
    expect(formatZoned("2026-08-24T15:00:00+00:00", BANGKOK)).not.toContain("15:00");
  });

  it("shows the raw value rather than nothing when it cannot be parsed", () => {
    expect(formatZoned("garbage", BANGKOK)).toBe("garbage");
  });
});

describe("zonedDate", () => {
  it("gives the local calendar day, not the UTC one", () => {
    // 23:30 in Bangkok is still the 24th there and already the 24th in UTC...
    expect(zonedDate("2026-08-24T16:30:00Z", BANGKOK)).toBe("2026-08-24");
    // ...but 20:00 UTC is the 25th in Bangkok, which `.slice(0, 10)` gets wrong.
    expect(zonedDate("2026-08-24T20:00:00Z", BANGKOK)).toBe("2026-08-25");
  });
});

describe("withZonedTimestamps", () => {
  it("adds the local reading beside the stored instant without replacing it", () => {
    const row = {
      id: "d-1",
      scheduled_at: "2026-08-24T15:00:00+00:00",
      taken_at: null,
      status: "scheduled",
    };

    const zoned = withZonedTimestamps(row, BANGKOK, ["scheduled_at", "taken_at"]);

    expect(zoned.scheduled_at).toBe("2026-08-24T15:00:00+00:00");
    expect(zoned.scheduled_at_local).toBe("2026-08-24T22:00:00+07:00");
    expect(zoned.taken_at_local).toBeNull();
    expect(zoned.status).toBe("scheduled");
  });
});

describe("instantFromInput", () => {
  it("takes an offset-bearing timestamp at face value", () => {
    const parsed = instantFromInput("2026-08-24T22:00:00+07:00", "UTC");

    expect(parsed).toEqual({ ok: true, instant: "2026-08-24T15:00:00.000Z", zoneApplied: false });
  });

  it("reads an offset-less wall clock in the caller's zone, not the server's", () => {
    const parsed = instantFromInput("2026-08-24T22:00", BANGKOK);

    expect(parsed).toEqual({ ok: true, instant: "2026-08-24T15:00:00.000Z", zoneApplied: true });
  });

  it("refuses input that is not a timestamp at all", () => {
    // `new Date("0")` is a valid date in JavaScript, which is exactly why this
    // path does not use it.
    expect(instantFromInput("0", BANGKOK).ok).toBe(false);
    expect(instantFromInput("tonight", BANGKOK).ok).toBe(false);
  });

  it("refuses a local time that does not exist in the zone", () => {
    // Berlin springs forward at 02:00 on 2026-03-29; 02:30 never happens.
    expect(instantFromInput("2026-03-29T02:30", BERLIN).ok).toBe(false);
  });

  it("says whether the zone was applied, so a reply can name it", () => {
    expect(instantFromInput("2026-08-24T22:00", BANGKOK).zoneApplied).toBe(true);
    expect(instantFromInput("2026-08-24T22:00:00Z", BANGKOK).zoneApplied).toBe(false);
  });
});
