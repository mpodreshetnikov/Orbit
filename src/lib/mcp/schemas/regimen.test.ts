import { describe, expect, it } from "vitest";
import { medDurationSchema, medScheduleSchema } from "./regimen";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);
}

describe("medScheduleSchema write checks", () => {
  it("accepts an ordinary schedule", () => {
    expect(
      medScheduleSchema.safeParse({
        mode: "daily_times",
        times: ["08:00", "20:00"],
        amounts: [1, 0.5],
      }).success,
    ).toBe(true);
  });

  it("refuses a repeated time, which the generator would silently drop", () => {
    const result = medScheduleSchema.safeParse({ mode: "daily_times", times: ["08:00", "08:00"] });
    expect(messages(result)).toEqual([
      "08:00 appears more than once; each time of day is one slot",
    ]);
  });

  it("refuses more amounts than times, on every mode that pairs them", () => {
    for (const schedule of [
      { mode: "daily_times", times: ["08:00"], amounts: [1, 2] },
      { mode: "interval_days", interval: { every: 2 }, times: ["08:00"], amounts: [1, 2] },
      { mode: "days_of_week", days_of_week: [1], times: ["08:00"], amounts: [1, 2] },
    ]) {
      expect(messages(medScheduleSchema.safeParse(schedule))).toEqual([
        "2 amounts for 1 times; give at most one amount per time",
      ]);
    }
  });

  it("accepts fewer amounts than times", () => {
    expect(
      medScheduleSchema.safeParse({ mode: "daily_times", times: ["08:00", "20:00"], amounts: [1] })
        .success,
    ).toBe(true);
  });

  it("refuses a fractional hours interval, which the generator's int cast cannot read", () => {
    expect(
      medScheduleSchema.safeParse({ mode: "interval_hours", interval: { every: 1.5 } }).success,
    ).toBe(false);
    expect(
      medScheduleSchema.safeParse({ mode: "interval_hours", interval: { every: 8 } }).success,
    ).toBe(true);
  });

  it("takes a one-off due time only as an instant", () => {
    expect(
      medScheduleSchema.safeParse({ mode: "one_off", due_at: "2026-10-21T09:00:00+07:00" }).success,
    ).toBe(true);
    expect(
      medScheduleSchema.safeParse({ mode: "one_off", due_at: "2026-10-21T02:00:00.000Z" }).success,
    ).toBe(true);
    for (const due_at of ["2026-10-21T09:00:00", "2026-10-21", "tomorrow morning"]) {
      expect(medScheduleSchema.safeParse({ mode: "one_off", due_at }).success).toBe(false);
    }
  });
});

describe("medDurationSchema write checks", () => {
  it("accepts calendar days in order, and an end with no start", () => {
    for (const duration of [
      { type: "until_date", start_date: "2026-10-01", end_date: "2026-10-01" },
      { type: "until_date", end_date: "2026-10-31" },
      { type: "for_days", days: 4, start_date: "2026-07-26" },
      { type: "endless", start_date: "2026-08-22" },
    ]) {
      expect(medDurationSchema.safeParse(duration).success).toBe(true);
    }
  });

  it("refuses an end before the start, a course that would never dose", () => {
    const result = medDurationSchema.safeParse({
      type: "until_date",
      start_date: "2026-09-10",
      end_date: "2026-09-01",
    });
    expect(messages(result)).toEqual(["end_date is before start_date"]);
  });

  it("refuses a date that is not a calendar day", () => {
    for (const start_date of ["2026-02-30", "26.07.2026", "2026-7-26"]) {
      expect(medDurationSchema.safeParse({ type: "for_days", days: 4, start_date }).success).toBe(
        false,
      );
    }
  });
});
