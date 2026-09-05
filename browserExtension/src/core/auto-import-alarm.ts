/**
 * When the periodic sweep is asked whether anything is due.
 *
 * The alarm used to be created with its period alone, so its first firing came a full period
 * after creation: three hours after every browser start, install or update. A browser that is
 * open for an evening never reached it, and the sweep that was meant to run "on its own" ran
 * only on a visit to the bank (no automatic session for a day after 0.1.15, 2026-09-05). The
 * cooldown decides whether a run actually happens; the alarm only has to ask soon.
 */
export const AUTO_IMPORT_ALARM_PERIOD_MINUTES = 180;
/** Long enough for the browser to settle and the banks' cookies to be live; not much more. */
export const FIRST_SWEEP_DELAY_MINUTES = 2;
/** An alarm due later than this at the browser's start is brought forward to the delay above. */
export const REARM_IF_FURTHER_THAN_MS = 15 * 60 * 1000;

export interface SweepAlarmSchedule {
  delayInMinutes: number;
  periodInMinutes: number;
}

export function sweepAlarmSchedule(): SweepAlarmSchedule {
  return {
    delayInMinutes: FIRST_SWEEP_DELAY_MINUTES,
    periodInMinutes: AUTO_IMPORT_ALARM_PERIOD_MINUTES,
  };
}

/**
 * Whether the alarm found at the browser's start should be re-armed to fire soon. One that is
 * missing, or whose next firing is further away than the re-arm window, is; one already about
 * to fire is left alone, or a start would postpone it.
 */
export function needsRearmAtStart(
  existing: { scheduledTime: number } | null | undefined,
  nowMs: number,
): boolean {
  if (!existing) return true;
  return existing.scheduledTime - nowMs > REARM_IF_FURTHER_THAN_MS;
}
