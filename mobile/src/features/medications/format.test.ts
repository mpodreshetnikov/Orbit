import type { MedRegimen } from "@orbit-types/regimen";
import { describe, expect, it } from "@jest/globals";
import {
  asUnit,
  formatAmountWithUnit,
  intakeAdviceLabel,
  isLowInventory,
  scheduleSummary,
} from "@/features/medications/format";

function course(
  schedule: unknown,
  intake_unit = "pill",
): Pick<MedRegimen, "schedule" | "intake_unit"> {
  return { schedule, intake_unit } as Pick<MedRegimen, "schedule" | "intake_unit">;
}

describe("formatAmountWithUnit", () => {
  it("declines the unit by the amount", () => {
    expect(formatAmountWithUnit(1, "pill")).toBe("1 таблетка");
    expect(formatAmountWithUnit(2, "pill")).toBe("2 таблетки");
    expect(formatAmountWithUnit(5, "pill")).toBe("5 таблеток");
    expect(formatAmountWithUnit(10, "ml")).toBe("10 мл");
  });
});

describe("asUnit", () => {
  it("keeps a known unit and reads anything else as other", () => {
    expect(asUnit("capsule")).toBe("capsule");
    expect(asUnit("bucket")).toBe("other");
    expect(asUnit(null)).toBe("other");
  });
});

describe("intakeAdviceLabel", () => {
  it("says nothing for none and prints custom text as written", () => {
    expect(intakeAdviceLabel({ intake_advice_type: "none" })).toBeNull();
    expect(
      intakeAdviceLabel({ intake_advice_type: "custom", intake_advice_text: " запить водой " }),
    ).toBe("запить водой");
  });

  it("names a catalogued advice from the web app's messages", () => {
    expect(intakeAdviceLabel({ intake_advice_type: "before_meal" })).toBe("Перед едой");
  });
});

describe("scheduleSummary", () => {
  it("lists daily times", () => {
    expect(scheduleSummary(course({ mode: "daily_times", times: ["09:00", "21:00"] }))).toBe(
      "Ежедневно в 09:00, 21:00",
    );
  });

  it("names weekdays in order, Sunday as 0 or 7", () => {
    expect(
      scheduleSummary(course({ mode: "days_of_week", days_of_week: [3, 1], times: ["08:00"] })),
    ).toBe("Пн, Ср в 08:00");
  });

  it("adds the amount to an hourly interval only when it is more than one", () => {
    expect(scheduleSummary(course({ mode: "interval_hours", interval: { every: 8 } }))).toBe(
      "Каждые 8 часов",
    );
    expect(
      scheduleSummary(course({ mode: "interval_hours", interval: { every: 8 }, amount: 2 })),
    ).toBe("Каждые 8 часов · 2 таблетки");
  });

  it("returns null for a schedule it cannot describe", () => {
    expect(scheduleSummary(course({ mode: "daily_times", times: [] }))).toBeNull();
    expect(scheduleSummary(course(null))).toBeNull();
  });
});

describe("isLowInventory", () => {
  it("is low at or under the threshold, and only when stock is tracked", () => {
    const at = (current: number, enabled = true) =>
      isLowInventory({
        inventory: { enabled, current_amount: current, refill_threshold_amount: 5 },
      });
    expect(at(5)).toBe(true);
    expect(at(6)).toBe(false);
    expect(at(1, false)).toBe(false);
  });
});

describe("scheduleSummary, the rarer modes", () => {
  it("prints a one-off intake's moment, and nothing for a missing or broken one", () => {
    expect(scheduleSummary(course({ mode: "one_off", due_at: "2026-10-21T09:30:00" }))).toMatch(
      /21 окт\. 2026 г\., 09:30/,
    );
    expect(scheduleSummary(course({ mode: "one_off", due_at: "" }))).toBeNull();
    expect(scheduleSummary(course({ mode: "one_off", due_at: "not a date" }))).toBeNull();
  });

  it("describes a day interval by its times, its legacy single time, or 09:00", () => {
    expect(
      scheduleSummary(course({ mode: "interval_days", interval: { every: 2 }, times: ["10:00"] })),
    ).toBe("Каждые 2 дней в 10:00");
    expect(
      scheduleSummary(
        course({ mode: "interval_days", interval: { every: 3 }, times: [], time_of_day: "07:30" }),
      ),
    ).toBe("Каждые 3 дней в 07:30");
    expect(scheduleSummary(course({ mode: "interval_days", interval: { every: 3 } }))).toBe(
      "Каждые 3 дней в 09:00",
    );
    expect(scheduleSummary(course({ mode: "interval_days", interval: {} }))).toBeNull();
  });

  it("reads 7 as Sunday and leaves out times it does not have", () => {
    expect(scheduleSummary(course({ mode: "days_of_week", days_of_week: [7] }))).toBe("Вс");
    expect(scheduleSummary(course({ mode: "days_of_week", days_of_week: [] }))).toBeNull();
  });

  it("returns null for an hourly interval without its step, and for an unknown mode", () => {
    expect(scheduleSummary(course({ mode: "interval_hours", interval: {} }))).toBeNull();
    expect(scheduleSummary(course({ mode: "lunar" }))).toBeNull();
  });
});

describe("intakeAdviceLabel, the edges", () => {
  it("says nothing for an empty custom text, an unknown type, or no course", () => {
    expect(
      intakeAdviceLabel({ intake_advice_type: "custom", intake_advice_text: "  " }),
    ).toBeNull();
    expect(intakeAdviceLabel({ intake_advice_type: "with_moonlight" })).toBeNull();
    expect(intakeAdviceLabel(null)).toBeNull();
  });
});
