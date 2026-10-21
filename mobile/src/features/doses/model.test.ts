import { describe, expect, it } from "@jest/globals";
import {
  clockTime,
  doseAmountLabel,
  doseName,
  doseUnit,
  isOneOff,
  plannedAmount,
  type DayDose,
} from "@/features/doses/model";

function dose(extra: Partial<DayDose>): DayDose {
  return {
    id: "d",
    regimen_id: "r",
    actual_at: "2026-10-21T08:00:00Z",
    taken_at: null,
    status: "scheduled",
    planned_intake: null,
    regimen: null,
    ...extra,
  };
}

describe("the dose model", () => {
  it("reads a missing or unusable planned amount as one", () => {
    expect(plannedAmount(null)).toBe(1);
    expect(plannedAmount({ intake: { amount: 0 } })).toBe(1);
    expect(plannedAmount({ intake: { amount: "2" } })).toBe(1);
    expect(plannedAmount({ intake: { amount: 2.5 } })).toBe(2.5);
  });

  it("takes the unit from the planned intake, then the course, then other", () => {
    expect(doseAmountLabel(dose({ planned_intake: { intake: { amount: 2, unit: "ml" } } }))).toBe(
      "2 мл",
    );
    expect(doseUnit(dose({ planned_intake: { intake: { unit: "drops" } } }))).toBe("drops");
    expect(doseUnit(dose({}))).toBe("other");
  });

  it("names an orphaned dose with a dash and an invalid time with dashes", () => {
    expect(doseName(dose({}))).toBe("—");
    expect(clockTime("not a time")).toBe("--:--");
    expect(isOneOff(dose({}))).toBe(false);
  });
});
