import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { matchTextFilter, normalizeComparableText } from "./rule-filter-text";

/**
 * Property pilots for money rule text operators (T-261113-k54 / ORB-63).
 * Behavioural table coverage for the Deno/SQL twins lives with `T-261113-qgz` —
 * these properties lock invariants so weak presence oracles cannot silently pass.
 */

describe("normalizeComparableText properties", () => {
  it("is idempotent and case/whitespace-insensitive", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (raw) => {
        const once = normalizeComparableText(raw);
        const twice = normalizeComparableText(once);
        expect(twice).toBe(once);
        if (once != null) {
          expect(once).toBe(once.toLowerCase());
          expect(once.includes("  ")).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("matchTextFilter properties", () => {
  it("contains is consistent with includes after normalize", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), fc.string({ maxLength: 12 }), (hay, needle) => {
        const expected = (() => {
          const h = normalizeComparableText(hay);
          const n = normalizeComparableText(needle);
          return Boolean(h && n && h.includes(n));
        })();
        expect(matchTextFilter("contains", hay, needle)).toBe(expected);
        if (expected) {
          expect(matchTextFilter("not_contains", hay, needle)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("equals is symmetric after normalize", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (value) => {
        const left = `  ${value.toUpperCase()}  `;
        const right = value;
        const a = matchTextFilter("equals", left, right);
        const b = matchTextFilter("equals", right, left);
        expect(a).toBe(b);
        if (normalizeComparableText(value) != null) {
          expect(matchTextFilter("equals", value, value)).toBe(true);
          expect(matchTextFilter("is_not_empty", value, null)).toBe(true);
        } else {
          expect(matchTextFilter("is_empty", value, null)).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  it("starts_with implies contains for non-empty needles", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (hay, needle) => {
          if (matchTextFilter("starts_with", hay, needle)) {
            expect(matchTextFilter("contains", hay, needle)).toBe(true);
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});
