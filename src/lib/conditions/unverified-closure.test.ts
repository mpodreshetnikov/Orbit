import { describe, it, expect } from "vitest";
import {
  AUTHORITATIVE_STATUS_FILTER,
  CLOSING_STATUSES,
  isUnverifiedClosure,
  type ClosureCandidate,
} from "./unverified-closure";
import { CONDITION_STATUSES } from "@/types/condition";

function mention(overrides: Partial<ClosureCandidate> = {}): ClosureCandidate {
  return {
    status_in_record: "resolved",
    is_llm_extracted: true,
    is_user_verified: false,
    ...overrides,
  };
}

describe("isUnverifiedClosure", () => {
  it("is true only for a machine-authored closure nobody has verified", () => {
    expect(isUnverifiedClosure(mention())).toBe(true);
    expect(isUnverifiedClosure(mention({ is_user_verified: true }))).toBe(false);
    expect(isUnverifiedClosure(mention({ is_llm_extracted: false }))).toBe(false);
    expect(isUnverifiedClosure(mention({ status_in_record: "active" }))).toBe(false);
  });

  it("covers history as well as resolved, because both take a condition off the chart", () => {
    expect(isUnverifiedClosure(mention({ status_in_record: "history" }))).toBe(true);
    expect(isUnverifiedClosure(mention({ status_in_record: "suspected" }))).toBe(false);
  });
});

/**
 * The predicate and the PostgREST filter are the same rule for two audiences: the filter decides
 * which rows may set a status, the predicate decides which rows may claim they did. If they ever
 * disagree, a reader shows a row the chart is ignoring as one it applied, or the reverse.
 *
 * So this does not restate the expected answers. It evaluates the filter string itself over every
 * combination of the three columns it names and asserts the predicate is its exact negation. A
 * change to either one that is not made to the other fails here.
 */
describe("the predicate is the negation of the filter", () => {
  /** A tiny reader for the `or=` argument: three comma-separated conditions, any one sufficient. */
  function rowPassesFilter(row: ClosureCandidate): boolean {
    const conditions = splitTopLevel(AUTHORITATIVE_STATUS_FILTER);
    expect(conditions).toHaveLength(3);
    return conditions.some((condition) => {
      const notIn = condition.match(/^status_in_record\.not\.in\.\(([^)]*)\)$/);
      if (notIn) return !notIn[1].split(",").includes(row.status_in_record);

      const is = condition.match(/^(\w+)\.is\.(true|false)$/);
      if (is) return row[is[1] as "is_llm_extracted" | "is_user_verified"] === (is[2] === "true");

      throw new Error(`unrecognised filter condition: ${condition}`);
    });
  }

  /** Commas inside `(...)` belong to the value list, not to the separator between conditions. */
  function splitTopLevel(filter: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of filter) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    parts.push(current);
    return parts;
  }

  it("agrees on every combination of the columns the filter names", () => {
    const combinations = CONDITION_STATUSES.flatMap((status) =>
      [true, false].flatMap((extracted) =>
        [true, false].map((verified) => ({
          status_in_record: status,
          is_llm_extracted: extracted,
          is_user_verified: verified,
        })),
      ),
    );
    expect(combinations).toHaveLength(16);

    for (const row of combinations) {
      expect({ row, suppressed: isUnverifiedClosure(row) }).toEqual({
        row,
        suppressed: !rowPassesFilter(row),
      });
    }
  });

  it("reads the filter rather than a copy of it", () => {
    // Guards the reader above: if the filter's shape changes so that these no longer parse, the
    // agreement test would quietly pass on a filter it did not understand.
    expect(AUTHORITATIVE_STATUS_FILTER).toContain(
      `status_in_record.not.in.(${CLOSING_STATUSES.join(",")})`,
    );
    expect(() => rowPassesFilter(mention())).not.toThrow();
  });
});
