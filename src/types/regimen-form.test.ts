import { describe, expect, it } from "vitest";
import type { MedRegimen, MedSchedule } from "./regimen";
import {
  baseDoseOf,
  courseToAddTo,
  durationWithStart,
  getInitialIntakeAdvice,
  intakeAdviceColumns,
  inventoryColumn,
  nextUnusedTime,
  oneTimeCourseColumns,
  oneTimeSubmission,
  regularCourseColumns,
  reminderSlots,
  reminderTimesProblem,
  scheduleForMode,
  withDayToggled,
  withIntervalEvery,
  withSlotAdded,
  withSlotChanged,
  withSlotRemoved,
  type CourseFormValues,
} from "./regimen-form";

const values: CourseFormValues = {
  name: " Магний ",
  unit: "pill",
  strength: { name: "", amount: 200, unit: "milligram" },
  intakeAdvice: "with_meal",
  intakeAdviceCustom: "",
  schedule: { mode: "daily_times", times: ["08:00", "21:00"], amounts: [1, 2] },
  duration: { type: "for_days", days: 30 },
  startDate: "2026-10-22",
  inventory: { enabled: true, current: "40", refillThreshold: "10" },
  notes: " после еды ",
};

const course = (extra: Partial<MedRegimen> = {}) =>
  ({
    id: "reg-1",
    custom_name: "Магний",
    dose_definition: { intake: { amount: 1, unit: "pill" } },
    ...extra,
  }) as MedRegimen;

describe("slots", () => {
  const daily: MedSchedule = { mode: "daily_times", times: ["09:00", "20:00"] };

  it("changes a time without inventing amounts, and an amount by aligning them all", () => {
    expect(withSlotChanged(daily, 1, "time", "21:00", 2)).toEqual({
      mode: "daily_times",
      times: ["09:00", "21:00"],
    });
    expect(withSlotChanged(daily, 1, "amount", 3, 2)).toEqual({
      mode: "daily_times",
      times: ["09:00", "20:00"],
      amounts: [2, 3],
    });
  });

  it("adds a slot at an unused time and removes one, never the last", () => {
    expect(withSlotAdded(daily, 1)).toEqual({ ...daily, times: ["09:00", "20:00", "12:00"] });
    expect(withSlotAdded({ ...daily, amounts: [2] }, 1)).toEqual({
      ...daily,
      times: ["09:00", "20:00", "12:00"],
      amounts: [2, 1, 2],
    });
    expect(withSlotRemoved({ ...daily, amounts: [1, 2] }, 0, 1)).toEqual({
      ...daily,
      times: ["20:00"],
      amounts: [2],
    });
    expect(withSlotRemoved({ mode: "daily_times", times: ["09:00"], amounts: [3] }, 0, 1)).toEqual({
      mode: "daily_times",
      times: ["09:00"],
      amounts: [1],
    });
    expect(withSlotRemoved(daily, 0, 1)).toEqual({ mode: "daily_times", times: ["20:00"] });
  });

  it("leaves a schedule without slots alone", () => {
    const hourly: MedSchedule = { mode: "interval_hours", interval: { every: 6 } };
    expect(withSlotChanged(hourly, 0, "time", "10:00", 1)).toBe(hourly);
    expect(withSlotAdded(hourly, 1)).toBe(hourly);
    expect(withSlotRemoved(hourly, 0, 1)).toBe(hourly);
    expect(withDayToggled(hourly, 1)).toBe(hourly);
    expect(reminderSlots(hourly, 1)).toEqual([]);
    expect(reminderTimesProblem(hourly)).toBe("");
  });

  it("toggles weekdays in order", () => {
    const weekly: MedSchedule = { mode: "days_of_week", days_of_week: [1, 5], times: ["09:00"] };
    expect(withDayToggled(weekly, 3)).toMatchObject({ days_of_week: [1, 3, 5] });
    expect(withDayToggled(weekly, 5)).toMatchObject({ days_of_week: [1] });
  });

  it("shows each slot's amount, the base one where it has none", () => {
    expect(reminderSlots({ ...daily, amounts: [2] }, 1)).toEqual([
      { time: "09:00", amount: 2 },
      { time: "20:00", amount: 1 },
    ]);
  });

  it("names a blank or a repeated time", () => {
    expect(reminderTimesProblem({ ...daily, times: ["09:00", ""] })).toBe(
      "medications.reminderTimeRequired",
    );
    expect(reminderTimesProblem({ ...daily, times: ["09:00", "09:00"] })).toBe(
      "medications.duplicateReminderTimes",
    );
    expect(reminderTimesProblem(daily)).toBe("");
  });

  it("finds a free time once every preset is taken", () => {
    const presets = ["09:00", "12:00", "15:00", "20:00", "23:00", "07:00", "10:00", "14:00"];
    expect(nextUnusedTime([...presets, "18:00", "21:00"])).toBe("00:00");
    const everyHalfHour = Array.from(
      { length: 48 },
      (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
    );
    expect(nextUnusedTime(everyHalfHour)).toBe("08:00");
  });
});

describe("frequency", () => {
  it("starts each mode on its defaults, and keeps what the same mode had", () => {
    const daily: MedSchedule = { mode: "daily_times", times: ["08:00"] };
    expect(scheduleForMode("daily_times", daily, null)).toEqual({
      mode: "daily_times",
      times: ["09:00"],
      amounts: [1],
    });
    expect(scheduleForMode("interval_hours", daily, null)).toEqual({
      mode: "interval_hours",
      interval: { every: 1 },
      amount: 1,
    });
    expect(
      scheduleForMode(
        "interval_hours",
        { mode: "interval_hours", interval: { every: 8 }, amount: 2 },
        null,
      ),
    ).toEqual({ mode: "interval_hours", interval: { every: 8 }, amount: 2 });
    expect(scheduleForMode("interval_days", daily, null)).toEqual({
      mode: "interval_days",
      interval: { every: 1 },
      times: ["09:00"],
      amounts: [1],
    });
    expect(
      scheduleForMode(
        "interval_days",
        { mode: "interval_days", interval: { every: 3 }, times: ["10:00"], amounts: [2] },
        null,
      ),
    ).toEqual({ mode: "interval_days", interval: { every: 3 }, times: ["10:00"], amounts: [2] });
  });

  it("brings back the last weekly plan", () => {
    const weekly = {
      mode: "days_of_week" as const,
      days_of_week: [2, 4],
      times: ["07:00"],
      amounts: [2],
    };
    expect(scheduleForMode("days_of_week", { mode: "daily_times", times: [] }, weekly)).toEqual(
      weekly,
    );
    expect(scheduleForMode("days_of_week", { mode: "daily_times", times: [] }, null)).toEqual({
      mode: "days_of_week",
      days_of_week: [1, 2, 3, 4, 5],
      times: ["09:00"],
    });
  });

  it("changes every N hours or days and nothing else", () => {
    expect(withIntervalEvery({ mode: "interval_hours", interval: { every: 1 } }, 6)).toEqual({
      mode: "interval_hours",
      interval: { every: 6 },
      amount: 1,
    });
    expect(
      withIntervalEvery({ mode: "interval_days", interval: { every: 1 }, times: ["08:00"] }, 2),
    ).toEqual({ mode: "interval_days", interval: { every: 2 }, times: ["08:00"], amounts: [1] });
    const daily: MedSchedule = { mode: "daily_times", times: ["08:00"] };
    expect(withIntervalEvery(daily, 2)).toBe(daily);
  });
});

describe("what a save writes", () => {
  it("writes a regular course", () => {
    expect(regularCourseColumns(values, null)).toEqual({
      custom_name: "Магний",
      intake_unit: "pill",
      dose_definition: {
        intake: { amount: 1, unit: "pill" },
        active: [],
        unit_strength: [{ name: "Магний", amount: 200, unit: "milligram" }],
      },
      intake_advice_type: "with_meal",
      intake_advice_text: null,
      schedule: values.schedule,
      duration: { type: "for_days", days: 30, start_date: "2026-10-22" },
      inventory: {
        enabled: true,
        current_amount: 40,
        refill_threshold_amount: 10,
        unit: "pill",
        auto_decrement_on_taken: true,
      },
      notes: "после еды",
    });
  });

  it("takes the base dose from the slots only when they all carry one", () => {
    expect(baseDoseOf({ mode: "daily_times", times: ["08:00", "20:00"], amounts: [2] }, 1)).toBe(1);
    expect(baseDoseOf({ mode: "daily_times", times: ["08:00"], amounts: [3] }, 1)).toBe(3);
    expect(baseDoseOf({ mode: "interval_hours", interval: { every: 6 }, amount: 2 }, 1)).toBe(2);
  });

  it("writes advice, stock and dates as the columns hold them", () => {
    expect(intakeAdviceColumns("", "")).toEqual({
      intake_advice_type: "none",
      intake_advice_text: null,
    });
    expect(intakeAdviceColumns("__none__", "x")).toEqual({
      intake_advice_type: "none",
      intake_advice_text: null,
    });
    expect(intakeAdviceColumns("custom", " с кефиром ")).toEqual({
      intake_advice_type: "custom",
      intake_advice_text: "с кефиром",
    });
    expect(intakeAdviceColumns("custom", " ")).toEqual({
      intake_advice_type: "custom",
      intake_advice_text: null,
    });
    expect(inventoryColumn({ enabled: false, current: "1", refillThreshold: "" }, "pill")).toBe(
      null,
    );
    expect(inventoryColumn({ enabled: true, current: "", refillThreshold: "" }, "ml")).toEqual({
      enabled: true,
      current_amount: 0,
      refill_threshold_amount: undefined,
      unit: "ml",
      auto_decrement_on_taken: true,
    });
    expect(durationWithStart({ type: "until_date", end_date: "2026-12-31" }, "2026-10-01")).toEqual(
      { type: "until_date", end_date: "2026-12-31", start_date: "2026-10-01" },
    );
    expect(durationWithStart({ type: "endless" }, "2026-10-01")).toEqual({
      type: "endless",
      start_date: "2026-10-01",
    });
  });

  it("opens advice on today's value for a legacy one", () => {
    expect(getInitialIntakeAdvice(course({ intake_advice_type: "after_dinner" }))).toBe(
      "after_meal",
    );
    expect(getInitialIntakeAdvice(course({ intake_advice_type: "none" }))).toBe("");
    expect(getInitialIntakeAdvice(null)).toBe("");
  });

  it("writes a one-off intake into the course of that name, or as a course of its own", () => {
    const oneOff = { name: "магний", unit: "pill" as const, strength: values.strength, notes: "" };
    expect(courseToAddTo("магний", null, [course()])).toBe("reg-1");
    expect(courseToAddTo("магний", "reg-2", [course()])).toBe("reg-2");
    expect(courseToAddTo("Ибупрофен", null, [course()])).toBeNull();
    expect(oneTimeSubmission(oneOff, "p-1", 2, "2026-10-22T09:00:00.000Z", "reg-1")).toEqual({
      addToRegimenId: "reg-1",
      scheduled_at: "2026-10-22T09:00:00.000Z",
      amount: 2,
      unit: "pill",
      notes: null,
    });
    expect(oneTimeSubmission(oneOff, "p-1", 2, "2026-10-22T09:00:00.000Z", null)).toEqual({
      person_id: "p-1",
      ...oneTimeCourseColumns(oneOff, null, 2, "2026-10-22T09:00:00.000Z"),
    });
    expect(oneTimeCourseColumns(oneOff, null, 0, "x")).toMatchObject({
      schedule: { mode: "one_off", due_at: "x" },
      dose_definition: { intake: { amount: 1, unit: "pill" } },
      inventory: null,
    });
  });
});
