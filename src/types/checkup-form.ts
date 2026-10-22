import type {
  CheckupCategory,
  CheckupItem,
  CheckupNextDueFrom,
  CheckupSchedule,
  CheckupWhyLink,
} from "./checkup";

/**
 * The checkup form's logic apart from the screens that draw it: the web form and the phone's sheet
 * open on the same values and save the same columns.
 */

export type FrequencyPreset = "1_month" | "3_month" | "6_month" | "1_year" | "custom";
export type IntervalUnit = "week" | "month" | "year";
export type AnchorPreset =
  | "next_period"
  | "first_of_year"
  | "first_of_month"
  | "winter"
  | "spring"
  | "summer"
  | "autumn"
  | "custom";

export const FREQUENCY_PRESETS: FrequencyPreset[] = [
  "1_month",
  "3_month",
  "6_month",
  "1_year",
  "custom",
];

const PRESET_INTERVALS: Record<Exclude<FrequencyPreset, "custom">, [number, IntervalUnit]> = {
  "1_month": [1, "month"],
  "3_month": [3, "month"],
  "6_month": [6, "month"],
  "1_year": [1, "year"],
};

/** Normalize a date to `YYYY-MM-DD`, or empty. */
export function toDateOnly(d: string | null | undefined): string {
  return d && typeof d === "string" ? d.slice(0, 10) : "";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The preset an interval is one of, or `custom`. */
export function frequencyPresetOf(every: number, unit: IntervalUnit): FrequencyPreset {
  const match = (Object.keys(PRESET_INTERVALS) as Exclude<FrequencyPreset, "custom">[]).find(
    (preset) => PRESET_INTERVALS[preset][0] === every && PRESET_INTERVALS[preset][1] === unit,
  );
  return match ?? "custom";
}

/** The interval a preset stands for; `custom` is the one typed. */
export function effectiveInterval(
  preset: FrequencyPreset,
  customEvery: number,
  customUnit: IntervalUnit,
): { every: number; unit: IntervalUnit } {
  if (preset === "custom") return { every: customEvery, unit: customUnit };
  const [every, unit] = PRESET_INTERVALS[preset];
  return { every, unit };
}

/** Where a schedule can start for an interval: seasons for a yearly one, the 1st for a monthly. */
export function anchorPresets(every: number, unit: IntervalUnit): AnchorPreset[] {
  if (unit === "year" || (unit === "month" && every >= 12)) {
    return ["next_period", "first_of_year", "winter", "spring", "summer", "autumn", "custom"];
  }
  if (unit === "month") return ["next_period", "first_of_month", "custom"];
  return ["next_period", "custom"];
}

const SEASON_MONTH = { winter: 12, spring: 3, summer: 6, autumn: 9 } as const;

/** The day a preset starts on, as of `now`; empty for "from today", which the database works out. */
export function anchorDateFor(preset: AnchorPreset, custom: string, now: Date): string {
  if (preset === "custom") return custom;
  if (preset === "first_of_year") return `${now.getFullYear() + 1}-01-01`;
  if (preset === "first_of_month") {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }
  if (preset === "next_period") return "";
  // A season's next start: this year's, unless it has passed.
  const month = SEASON_MONTH[preset];
  const year =
    new Date(now.getFullYear(), month - 1, 1) < now ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-${pad(month)}-01`;
}

export interface CheckupFormValues {
  title: string;
  category: CheckupCategory;
  scheduleType: "interval" | "one_off";
  preset: FrequencyPreset;
  customEvery: number;
  customUnit: IntervalUnit;
  anchorPreset: AnchorPreset;
  customAnchorDate: string;
  nextDueFrom: CheckupNextDueFrom;
  oneOffDueAt: string;
  reminderDaysBefore: number[];
  whyText: string;
  whyLinks: CheckupWhyLink[];
}

/** The form opened on `initial`, or on the web form's defaults for a new checkup. */
export function initialCheckupForm(initial: CheckupItem | null | undefined): CheckupFormValues {
  const schedule = initial?.schedule;
  const interval = schedule?.type === "interval" ? schedule : null;
  const unit = (interval?.unit ?? "month") as IntervalUnit;
  const preset = interval ? frequencyPresetOf(interval.every, unit) : "6_month";
  const anchor = toDateOnly(interval?.anchor_date);
  return {
    title: initial?.title ?? "",
    category: initial?.category ?? "visit",
    scheduleType: schedule?.type === "one_off" ? "one_off" : "interval",
    preset,
    customEvery: interval && preset === "custom" ? interval.every : 1,
    customUnit: unit,
    anchorPreset: anchor ? "custom" : "next_period",
    customAnchorDate: anchor,
    nextDueFrom: interval?.next_due_from ?? "completion",
    oneOffDueAt: schedule?.type === "one_off" ? toDateOnly(schedule.due_at) : "",
    reminderDaysBefore: Array.isArray(initial?.reminder_days_before)
      ? [...initial.reminder_days_before]
      : [7],
    whyText: initial?.why_text ?? "",
    whyLinks: Array.isArray(initial?.why_links) ? initial.why_links : [],
  };
}

/** The schedule the form describes, as of `now`. */
export function checkupSchedule(form: CheckupFormValues, now: Date): CheckupSchedule {
  if (form.scheduleType === "one_off") return { type: "one_off", due_at: form.oneOffDueAt };
  const { every, unit } = effectiveInterval(form.preset, form.customEvery, form.customUnit);
  const anchorDate = anchorDateFor(form.anchorPreset, form.customAnchorDate, now);
  return {
    type: "interval",
    every,
    unit,
    ...(anchorDate ? { anchor_date: anchorDate } : {}),
    ...(form.nextDueFrom !== "completion" ? { next_due_from: form.nextDueFrom } : {}),
  };
}

/** What stops a save: no title, or a one-off checkup with no date. */
export function checkupFormProblem(form: CheckupFormValues): "title" | "dueDate" | null {
  if (!form.title.trim()) return "title";
  if (form.scheduleType === "one_off" && !form.oneOffDueAt.trim()) return "dueDate";
  return null;
}

/** The columns a save writes, for a new checkup or an edited one. */
export function checkupColumns(form: CheckupFormValues, now: Date) {
  return {
    title: form.title.trim(),
    category: form.category,
    schedule: checkupSchedule(form, now),
    reminder_days_before: form.reminderDaysBefore
      .filter((d) => typeof d === "number" && d >= 0)
      .sort((a, b) => b - a),
    why_text: form.whyText.trim() || null,
    why_links: form.whyLinks,
  };
}

/** Link a condition, or unlink it when it is linked already. */
export function toggleConditionLink(
  links: CheckupWhyLink[],
  condition: { id: string; name: string },
): CheckupWhyLink[] {
  return links.some((link) => link.type === "condition" && link.id === condition.id)
    ? links.filter((link) => !(link.type === "condition" && link.id === condition.id))
    : [...links, { type: "condition", id: condition.id, label: condition.name }];
}
