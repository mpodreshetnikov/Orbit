/**
 * How often the extension imports on its own, as the person set it on the import page.
 *
 * Three shapes, because people reconcile money on a rhythm, not an interval: every N days,
 * once a week (at its start or its end), once a month (at its start or its end). A week or a
 * month is due from its anchor -- Monday or Sunday, the first or the last day, at local
 * midnight -- and the first run the sweep gets in after that anchor covers it.
 *
 * Kept free of `chrome.*` so the arithmetic can be tested directly.
 */

export type AutoScheduleEdge = "start" | "end";

export type AutoSchedule =
  | { kind: "days"; every: number }
  | { kind: "week"; at: AutoScheduleEdge }
  | { kind: "month"; at: AutoScheduleEdge };

export const MIN_SCHEDULE_DAYS = 1;
export const MAX_SCHEDULE_DAYS = 30;

/** What the extension did before the schedule existed: once a day. */
export const DEFAULT_AUTO_SCHEDULE: AutoSchedule = { kind: "days", every: 1 };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A run every N days lands four hours early on purpose, so a visit at roughly the same hour
 * N days later still counts rather than being turned away for being an hour early. With N = 1
 * this is the 20 hours the extension has always waited.
 */
export const DAYS_SCHEDULE_SLACK_MS = 4 * HOUR_MS;

function isEdge(value: unknown): value is AutoScheduleEdge {
  return value === "start" || value === "end";
}

/** Reads a schedule from storage or a page message; anything unreadable is the default. */
export function normalizeAutoSchedule(value: unknown): AutoSchedule {
  if (!value || typeof value !== "object") return DEFAULT_AUTO_SCHEDULE;
  const record = value as Record<string, unknown>;
  if (record.kind === "days") {
    const every = typeof record.every === "number" ? Math.round(record.every) : Number.NaN;
    if (!Number.isFinite(every)) return DEFAULT_AUTO_SCHEDULE;
    return {
      kind: "days",
      every: Math.min(MAX_SCHEDULE_DAYS, Math.max(MIN_SCHEDULE_DAYS, every)),
    };
  }
  if ((record.kind === "week" || record.kind === "month") && isEdge(record.at)) {
    return { kind: record.kind, at: record.at };
  }
  return DEFAULT_AUTO_SCHEDULE;
}

/** Local midnight of the day `ms` falls on. */
function startOfDay(ms: number): Date {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** The first anchor of a week or month schedule strictly after `afterMs`, at local midnight. */
function nextAnchorAfter(schedule: Exclude<AutoSchedule, { kind: "days" }>, afterMs: number) {
  const day = startOfDay(afterMs);
  if (schedule.kind === "week") {
    // getDay: Sunday 0, Monday 1. The week starts on Monday and ends on Sunday.
    const target = schedule.at === "start" ? 1 : 0;
    let ahead = (target - day.getDay() + 7) % 7;
    if (ahead === 0 && day.getTime() <= afterMs) ahead = 7;
    day.setDate(day.getDate() + ahead);
    return day.getTime();
  }
  const anchorIn = (year: number, month: number) =>
    schedule.at === "start"
      ? new Date(year, month, 1).getTime()
      : // Day 0 of the next month is the last day of this one, whatever its length.
        new Date(year, month + 1, 0).getTime();
  const thisMonth = anchorIn(day.getFullYear(), day.getMonth());
  return thisMonth > afterMs ? thisMonth : anchorIn(day.getFullYear(), day.getMonth() + 1);
}

/**
 * When the next run is due after a success at `lastOkAtMs`. Never imported means due now.
 * A run that lands after the anchor covers it, so the next one waits for the anchor after that.
 */
export function scheduleDueAtMs(schedule: AutoSchedule, lastOkAtMs: number | null): number {
  if (lastOkAtMs === null) return Number.NEGATIVE_INFINITY;
  if (schedule.kind === "days") {
    return lastOkAtMs + schedule.every * DAY_MS - DAYS_SCHEDULE_SLACK_MS;
  }
  return nextAnchorAfter(schedule, lastOkAtMs);
}
