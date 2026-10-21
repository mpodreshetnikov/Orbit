/**
 * One household's worth of rows for screen tests: Max, two running courses and a finished one, and
 * a day of doses around a fixed noon. `NOW` is the instant every screen test freezes time at.
 */
export const NOW = new Date(2026, 9, 21, 12, 0);

export const USER_ID = "user-1";
export const PERSON = { id: "person-1", name: "Max", kind: "human", auth_user_id: USER_ID };

function at(hour: number, minute = 0, dayOffset = 0): string {
  return new Date(2026, 9, 21 + dayOffset, hour, minute).toISOString();
}

/** A `med_regimens` row as the screens read it; loose where rows legitimately differ. */
export type CourseRow = {
  id: string;
  person_id: string;
  custom_name: string;
  status: string;
  intake_unit: string;
  intake_advice_type: string | null;
  intake_advice_text: string | null;
  schedule: unknown;
  duration: unknown;
  inventory: unknown;
  notes: string | null;
  [column: string]: unknown;
};

export const VITAMIN_D: CourseRow = {
  id: "reg-vitd",
  person_id: PERSON.id,
  custom_name: "Vitamin D3",
  status: "active",
  intake_unit: "capsule",
  dose_definition: null,
  intake_advice_type: "with_meal",
  intake_advice_text: null,
  schedule: { mode: "daily_times", times: ["08:00"] },
  duration: { type: "endless", start_date: "2026-10-01" },
  reminder_prefs: null,
  inventory: { enabled: true, current_amount: 3, refill_threshold_amount: 5 },
  notes: "После завтрака",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  deleted_at: null,
};

export const MAGNESIUM: CourseRow = {
  ...VITAMIN_D,
  id: "reg-mg",
  custom_name: "Магний",
  intake_unit: "pill",
  intake_advice_type: null,
  schedule: { mode: "daily_times", times: ["08:00", "21:00"] },
  duration: { type: "until_date", start_date: "2026-10-01", end_date: "2026-12-31" },
  inventory: null,
  notes: null,
  created_at: "2026-10-02T00:00:00Z",
};

export const OMEPRAZOLE: CourseRow = {
  ...VITAMIN_D,
  id: "reg-omep",
  custom_name: "Омепразол",
  status: "paused",
  intake_unit: "capsule",
  intake_advice_type: "before_meal",
  schedule: { mode: "interval_hours", interval: { every: 12 }, amount: 2 },
  duration: { type: "for_days", start_date: "2026-09-01", days: 14 },
  inventory: { enabled: false },
  notes: null,
  created_at: "2026-09-01T00:00:00Z",
};

function regimenJoin(regimen: CourseRow) {
  const { custom_name, intake_unit, intake_advice_type, intake_advice_text, schedule } = regimen;
  return { custom_name, intake_unit, intake_advice_type, intake_advice_text, schedule };
}

export function dose(
  id: string,
  regimen: CourseRow,
  actualAt: string,
  status = "scheduled",
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    regimen_id: regimen.id,
    person_id: PERSON.id,
    actual_at: actualAt,
    taken_at: null,
    status,
    deleted_at: null,
    planned_intake: { intake: { amount: 1, unit: regimen.intake_unit } },
    regimen: regimenJoin(regimen),
    ...extra,
  };
}

/** Today: two doses at 08:00 (one overdue, one taken), one ahead at 21:00, yesterday's skipped one. */
export function household() {
  return {
    persons: [PERSON],
    med_regimens: [VITAMIN_D, MAGNESIUM, OMEPRAZOLE],
    med_dose_events: [
      dose("d-vitd-0800", VITAMIN_D, at(8)),
      dose("d-mg-0800", MAGNESIUM, at(8), "taken", { taken_at: at(8, 5) }),
      dose("d-mg-2100", MAGNESIUM, at(21)),
      dose("d-mg-yday", MAGNESIUM, at(21, 0, -1), "skipped"),
    ],
  };
}
