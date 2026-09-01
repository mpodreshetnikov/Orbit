/**
 * Plans what one import run should cover.
 *
 * Pulling a year of history in a single pass does not work: every operation costs three
 * requests, receipts are throttled hard, and a run that long runs into the bank's limits and
 * gets abandoned half-finished. Instead each run does two bounded things — catch up on the
 * last few days, then take one month-sized bite out of the history — and a cursor remembers
 * how deep the history has been walked. Two or three weeks of ordinary daily use closes half
 * a year without a single long run.
 *
 * This module holds no `chrome.*` calls on purpose: the decisions are the part worth testing,
 * and they are all pure functions of a timestamp and the stored state.
 */

export interface BackfillState {
  /** Start of the oldest slice already taken, or null before the first one. */
  cursorMs: number | null;
  /** How far back history is walked before the backfill is considered done. */
  horizonMonths: number;
  /** When the walk reached the horizon, or null while it is still going. */
  completedAtMs: number | null;
  /**
   * The end of the last catch-up window that finished, or null before the first one.
   *
   * Without it the catch-up was always the last few days and nothing else, so a pause longer
   * than the lookback -- a closed browser, a disabled extension, a week signed out -- left a gap
   * that neither path ever covered: the catch-up starts too late, and the history walk only ever
   * goes deeper than where it began.
   */
  lastIncrementalToMs: number | null;
}

export interface BackfillSlice {
  windowFromIso: string;
  windowToIso: string;
}

export const DEFAULT_INCREMENTAL_LOOKBACK_DAYS = 3;
export const DEFAULT_BACKFILL_HORIZON_MONTHS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

export function createInitialBackfillState(
  horizonMonths = DEFAULT_BACKFILL_HORIZON_MONTHS,
): BackfillState {
  return { cursorMs: null, horizonMonths, completedAtMs: null, lastIncrementalToMs: null };
}

/**
 * The catch-up window every run starts with: recent days, cheap and always worth redoing.
 *
 * It reaches back to whichever is earlier -- the fixed lookback, or where the last catch-up
 * ended. The lookback alone left a hole whenever runs stopped for longer than it: a fortnight
 * with the browser closed, and the fortnight's transactions belonged to no window at all, since
 * the history walk only ever goes deeper than where it started. The lookback still applies on
 * top of a recent end, because it is also the overlap that catches operations the bank posted
 * late.
 */
export function planIncrementalWindow(
  state: BackfillState | null,
  nowMs: number,
  lookbackDays = DEFAULT_INCREMENTAL_LOOKBACK_DAYS,
): BackfillSlice {
  const spanMs = Math.max(1, lookbackDays) * DAY_MS;
  const lookbackFromMs = nowMs - spanMs;
  const lastEndMs = state?.lastIncrementalToMs ?? null;
  const fromMs =
    lastEndMs !== null && Number.isFinite(lastEndMs)
      ? Math.min(lookbackFromMs, lastEndMs - spanMs)
      : lookbackFromMs;

  return {
    windowFromIso: new Date(fromMs).toISOString(),
    windowToIso: new Date(nowMs).toISOString(),
  };
}

function shiftMonths(fromMs: number, months: number): number {
  const date = new Date(fromMs);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

/**
 * The next month-sized slice to walk, or null when the horizon is reached.
 *
 * The first slice starts where the incremental window ends and steps one month back; each
 * later one continues from the cursor. Returning null also stamps `completedAtMs`, so the
 * caller can tell "nothing left to do" from "not started".
 */
export function planBackfillSlice(
  state: BackfillState,
  nowMs: number,
  lookbackDays = DEFAULT_INCREMENTAL_LOOKBACK_DAYS,
): { slice: BackfillSlice; nextState: BackfillState } | null {
  const horizonMonths =
    Number.isFinite(state.horizonMonths) && state.horizonMonths > 0
      ? Math.floor(state.horizonMonths)
      : DEFAULT_BACKFILL_HORIZON_MONTHS;
  const horizonMs = shiftMonths(nowMs, -horizonMonths);

  // The walk starts where the *first* catch-up window began, not where the latest one does --
  // otherwise a catch-up widened by a long pause would leave the slice below it re-reading
  // ground the catch-up has already covered.
  const sliceEndMs = state.cursorMs ?? nowMs - Math.max(1, lookbackDays) * DAY_MS;
  if (sliceEndMs <= horizonMs) {
    return null;
  }

  const sliceStartMs = Math.max(horizonMs, shiftMonths(sliceEndMs, -1));

  return {
    slice: {
      windowFromIso: new Date(sliceStartMs).toISOString(),
      windowToIso: new Date(sliceEndMs).toISOString(),
    },
    nextState: {
      ...state,
      horizonMonths,
      cursorMs: sliceStartMs,
      completedAtMs: sliceStartMs <= horizonMs ? nowMs : null,
    },
  };
}

export interface BackfillSliceOutcome {
  /** False when the run errored; the cursor must not move past a slice that failed. */
  ok: boolean;
  /** Receipts the run left unread, for any reason: budget, rate limit, or outright failure. */
  unreadReceiptCount: number;
  /** True when the connector could not prove it read the whole slice. */
  partial: boolean;
}

/**
 * Whether a finished slice may move the cursor deeper.
 *
 * The cursor only moves past a slice that is genuinely done. A slice that errored, that ran
 * out of receipt budget, or that the connector could not read in full gets taken again —
 * because the walk passes each slice once, and anything skipped on that single pass would
 * never be collected by anything.
 */
export function shouldAdvanceBackfillCursor(outcome: BackfillSliceOutcome): boolean {
  return outcome.ok && outcome.unreadReceiptCount === 0 && !outcome.partial;
}
