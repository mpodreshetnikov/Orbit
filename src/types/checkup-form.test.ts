import { describe, expect, it } from "vitest";
import type { CheckupItem } from "./checkup";
import {
  anchorDateFor,
  anchorPresets,
  checkupColumns,
  checkupFormProblem,
  effectiveInterval,
  frequencyPresetOf,
  initialCheckupForm,
  toggleConditionLink,
  toDateOnly,
} from "./checkup-form";

const NOW = new Date(2026, 9, 21, 12, 0);

const item = (extra: Partial<CheckupItem>): CheckupItem => ({
  id: "a",
  person_id: "p",
  title: "Анализ",
  category: "lab",
  schedule: { type: "interval", every: 2, unit: "week", anchor_date: "2026-11-02T00:00:00Z" },
  next_due_at: null,
  status: "active",
  reminder_days_before: [1, 7],
  planned_on: null,
  why_text: "Контроль",
  why_links: [{ type: "condition", id: "c", label: "Анемия" }],
  notes: null,
  created_at: "",
  updated_at: "",
  ...extra,
});

describe("initialCheckupForm", () => {
  it("opens a new checkup on the web form's defaults", () => {
    expect(initialCheckupForm(null)).toMatchObject({
      title: "",
      category: "visit",
      scheduleType: "interval",
      preset: "6_month",
      customEvery: 1,
      customUnit: "month",
      anchorPreset: "next_period",
      nextDueFrom: "completion",
      oneOffDueAt: "",
      reminderDaysBefore: [7],
      whyLinks: [],
    });
  });

  it("opens a custom interval with its anchor, and a one-off with its day", () => {
    expect(initialCheckupForm(item({}))).toMatchObject({
      preset: "custom",
      customEvery: 2,
      customUnit: "week",
      anchorPreset: "custom",
      customAnchorDate: "2026-11-02",
    });
    expect(
      initialCheckupForm(
        item({
          schedule: { type: "one_off", due_at: "2026-12-01" },
          reminder_days_before: null as unknown as number[],
          why_links: null as unknown as [],
        }),
      ),
    ).toMatchObject({
      scheduleType: "one_off",
      oneOffDueAt: "2026-12-01",
      reminderDaysBefore: [7],
      whyLinks: [],
    });
    expect(
      initialCheckupForm(
        item({ schedule: { type: "interval", every: 1, unit: "year", next_due_from: "target" } }),
      ),
    ).toMatchObject({ preset: "1_year", customEvery: 1, nextDueFrom: "target" });
  });
});

describe("the interval", () => {
  it("names the presets and reads them back", () => {
    expect(frequencyPresetOf(3, "month")).toBe("3_month");
    expect(frequencyPresetOf(3, "week")).toBe("custom");
    expect(effectiveInterval("1_year", 5, "week")).toEqual({ every: 1, unit: "year" });
    expect(effectiveInterval("custom", 5, "week")).toEqual({ every: 5, unit: "week" });
  });

  it("offers seasons for a yearly interval, the 1st for a monthly one", () => {
    expect(anchorPresets(1, "year")).toContain("winter");
    expect(anchorPresets(12, "month")).toContain("first_of_year");
    expect(anchorPresets(3, "month")).toEqual(["next_period", "first_of_month", "custom"]);
    expect(anchorPresets(2, "week")).toEqual(["next_period", "custom"]);
  });

  it("dates each anchor from now", () => {
    expect(anchorDateFor("next_period", "", NOW)).toBe("");
    expect(anchorDateFor("custom", "2027-02-02", NOW)).toBe("2027-02-02");
    expect(anchorDateFor("first_of_year", "", NOW)).toBe("2027-01-01");
    expect(anchorDateFor("first_of_month", "", NOW)).toBe("2026-11-01");
    // The end of a long month does not overflow past the next one, and December rolls the year.
    expect(anchorDateFor("first_of_month", "", new Date(2027, 0, 31, 23, 30))).toBe("2027-02-01");
    expect(anchorDateFor("first_of_month", "", new Date(2026, 11, 15))).toBe("2027-01-01");
    expect(anchorDateFor("winter", "", NOW)).toBe("2026-12-01");
    expect(anchorDateFor("spring", "", NOW)).toBe("2027-03-01");
  });
});

describe("saving", () => {
  it("needs a title, and a day for a one-off", () => {
    const form = initialCheckupForm(null);
    expect(checkupFormProblem(form)).toBe("title");
    expect(checkupFormProblem({ ...form, title: "Окулист", scheduleType: "one_off" })).toBe(
      "dueDate",
    );
    expect(checkupFormProblem({ ...form, title: "Окулист" })).toBeNull();
  });

  it("writes trimmed columns, the reminders furthest first", () => {
    const form = {
      ...initialCheckupForm(item({})),
      title: " Анализ ",
      whyText: " ",
      reminderDaysBefore: [1, -1, 14],
      nextDueFrom: "target" as const,
    };
    expect(checkupColumns(form, NOW)).toEqual({
      title: "Анализ",
      category: "lab",
      schedule: {
        type: "interval",
        every: 2,
        unit: "week",
        anchor_date: "2026-11-02",
        next_due_from: "target",
      },
      reminder_days_before: [14, 1],
      why_text: null,
      why_links: [{ type: "condition", id: "c", label: "Анемия" }],
    });
    expect(
      checkupColumns({ ...form, scheduleType: "one_off", oneOffDueAt: "2026-12-01" }, NOW).schedule,
    ).toEqual({ type: "one_off", due_at: "2026-12-01" });
    expect(checkupColumns(initialCheckupForm(null), NOW).schedule).toEqual({
      type: "interval",
      every: 6,
      unit: "month",
    });
  });

  it("links a condition and unlinks it again", () => {
    const linked = toggleConditionLink([], { id: "c", name: "Анемия" });
    expect(linked).toEqual([{ type: "condition", id: "c", label: "Анемия" }]);
    expect(toggleConditionLink(linked, { id: "c", name: "Анемия" })).toEqual([]);
  });

  it("cuts a date to its day", () => {
    expect(toDateOnly("2026-11-02T10:00:00Z")).toBe("2026-11-02");
    expect(toDateOnly(null)).toBe("");
  });
});
