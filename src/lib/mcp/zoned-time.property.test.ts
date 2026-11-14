import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { formatZoned, offsetLabel, zonedDate, zonedIso } from "./zoned-time";

/**
 * Property pilots for TZ utils (T-261113-k54 / ORB-63).
 * Table-driven cases in `zoned-time.test.ts` remain the behavioural oracle;
 * these check invariants across ranges that hand-written tables rarely cover.
 */

describe("offsetLabel properties", () => {
  it("always emits ±HH:MM for whole-minute offsets in a realistic range", () => {
    fc.assert(
      fc.property(fc.integer({ min: -14 * 60, max: 14 * 60 }), (minutes) => {
        const label = offsetLabel(minutes);
        expect(label).toMatch(/^[+-]\d{2}:\d{2}$/);
        const sign = label.startsWith("-") ? -1 : 1;
        const [hh, mm] = label.slice(1).split(":").map(Number);
        expect(sign * (hh * 60 + mm)).toBe(minutes);
      }),
      { numRuns: 100 },
    );
  });
});

describe("zonedIso / zonedDate properties", () => {
  const zones = ["UTC", "Asia/Bangkok", "Europe/Berlin", "Asia/Krasnoyarsk", "America/New_York"];

  it("zonedDate is the calendar prefix of zonedIso for valid instants", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Date.parse("2020-01-01T00:00:00Z"),
          max: Date.parse("2030-12-31T23:59:59Z"),
        }),
        fc.constantFrom(...zones),
        (epochMs, zone) => {
          const isoInstant = new Date(epochMs).toISOString();
          const local = zonedIso(isoInstant, zone);
          expect(local).not.toBeNull();
          expect(zonedDate(isoInstant, zone)).toBe(local!.slice(0, 10));
        },
      ),
      { numRuns: 80 },
    );
  });

  it("formatZoned never drops the offset for a parseable instant", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Date.parse("2020-01-01T00:00:00Z"),
          max: Date.parse("2030-12-31T23:59:59Z"),
        }),
        fc.constantFrom(...zones),
        (epochMs, zone) => {
          const rendered = formatZoned(new Date(epochMs).toISOString(), zone);
          expect(rendered).toMatch(/[+-]\d{2}:\d{2}$/);
        },
      ),
      { numRuns: 80 },
    );
  });
});
