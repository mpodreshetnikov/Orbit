import { describe, expect, it } from "vitest";
import {
  formatMedicationAmount,
  getMedicationAmountForTime,
  isMedicationScheduleDaily,
  isMedicationScheduleDaysOfWeek,
  isMedicationScheduleInterval,
  medicationUnitKey,
  type Medication,
  type MedicationScheduleFrequency,
} from "./medication";

function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "m-1",
    person_id: "person-1",
    name: "Test med",
    kind: "regular",
    unit: "pill",
    dose_per_unit: null,
    intake_advice: null,
    intake_advice_custom: null,
    scheduled_at: null,
    one_time_amount: null,
    schedule: null,
    inventory_enabled: false,
    inventory_current: null,
    inventory_refill_threshold: null,
    status: "active",
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("medication types helpers", () => {
  it("formats unit keys and display amount", () => {
    expect(medicationUnitKey("pill")).toBe("medications.unitPill");
    expect(medicationUnitKey("milligram")).toBe("medications.unitMilligram");
    expect(formatMedicationAmount(2, "pills")).toBe("2 pills");
  });

  it("narrows schedule frequency guards", () => {
    const daily: MedicationScheduleFrequency = { type: "daily" };
    const interval: MedicationScheduleFrequency = { type: "interval", every: 8, unit: "hour" };
    const dow: MedicationScheduleFrequency = { type: "days_of_week", days: [1, 3, 5] };

    expect(isMedicationScheduleDaily(daily)).toBe(true);
    expect(isMedicationScheduleDaily(interval)).toBe(false);

    expect(isMedicationScheduleInterval(interval)).toBe(true);
    expect(isMedicationScheduleInterval(dow)).toBe(false);

    expect(isMedicationScheduleDaysOfWeek(dow)).toBe(true);
    expect(isMedicationScheduleDaysOfWeek(daily)).toBe(false);
  });

  it("computes amount for one-time and regular reminder slots", () => {
    const oneTimeWithAmount = makeMedication({
      kind: "one_time",
      one_time_amount: 3,
    });
    const oneTimeWithoutAmount = makeMedication({
      kind: "one_time",
      one_time_amount: null,
    });
    const regularWithoutSchedule = makeMedication({
      kind: "regular",
      schedule: null,
    });
    const regularWithoutSlots = makeMedication({
      kind: "regular",
      schedule: {
        frequency: { type: "daily" },
        duration: { start_date: "2026-01-01", end_type: "endless" },
        reminder_times: [],
      },
    });
    const regularWithSlots = makeMedication({
      kind: "regular",
      schedule: {
        frequency: { type: "daily" },
        duration: { start_date: "2026-01-01", end_type: "endless" },
        reminder_times: [
          { time: "09:00", amount: 2 },
          { time: "20:00", amount: 1 },
        ],
      },
    });
    const regularWithNullAmount = makeMedication({
      kind: "regular",
      schedule: {
        frequency: { type: "daily" },
        duration: { start_date: "2026-01-01", end_type: "endless" },
        reminder_times: [{ time: "09:00", amount: null as unknown as number }],
      },
    });

    expect(getMedicationAmountForTime(oneTimeWithAmount, "09:00")).toBe(3);
    expect(getMedicationAmountForTime(oneTimeWithoutAmount, "09:00")).toBe(1);
    expect(getMedicationAmountForTime(regularWithoutSchedule, "09:00")).toBe(1);
    expect(getMedicationAmountForTime(regularWithoutSlots, "09:00")).toBe(1);
    expect(getMedicationAmountForTime(regularWithSlots, "09:00")).toBe(2);
    expect(getMedicationAmountForTime(regularWithSlots, "15:00")).toBe(1);
    expect(getMedicationAmountForTime(regularWithNullAmount, "09:00")).toBe(1);
  });
});
