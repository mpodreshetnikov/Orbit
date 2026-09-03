import type { AutoRunState } from "./auto-run-policy.js";
import { lastOkAtMsOf } from "./auto-run-policy.js";

/**
 * Decides when a source has gone quiet for long enough that a person should be asked to help,
 * and how often the asking may happen.
 *
 * The alarm can open the bank; it cannot sign in. Once the bank's own session has expired every
 * unattended attempt lands on the login screen, the backoff widens, and after three attempts the
 * extension stops -- silently, by design, because nobody asked for those runs. Somebody has to
 * be told, and the only party who can help is a person at this computer: a push on a phone
 * cannot open a desktop browser. Kept free of `chrome.*` so the decisions can be tested directly.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** How long without a successful run before a source counts as stale. The owner's default: a day. */
export const DEFAULT_STALE_AFTER_MS = DAY_MS;
export const MIN_STALE_AFTER_MS = HOUR_MS;
export const MAX_STALE_AFTER_MS = 30 * DAY_MS;

/**
 * The attention page is opened on the extension's own initiative at most this often. A tab that
 * appears in the middle of someone's work is an interruption; once a day, at the browser's
 * start when it can be, is a reminder.
 */
export const ATTENTION_PAGE_MIN_INTERVAL_MS = DAY_MS;

/**
 * A request to run on the next visit is honoured for this long. Signing in takes minutes; a
 * request found days later would start a run the person has forgotten asking for.
 */
export const RUN_REQUEST_TTL_MS = HOUR_MS;

/** A stored or requested threshold, brought inside the bounds; anything unreadable is the default. */
export function normalizeStaleAfterMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_STALE_AFTER_MS;
  return Math.min(MAX_STALE_AFTER_MS, Math.max(MIN_STALE_AFTER_MS, Math.round(value)));
}

export interface SourceFreshness {
  /** When the source last imported successfully; null when it never has. */
  lastOkAtMs: number | null;
  /** What staleness is measured from: the last success, or the grant's arrival before any. */
  sinceMs: number;
  staleForMs: number;
  stale: boolean;
}

/**
 * Measured from the last successful run, not from the dates of what was imported: a week with
 * no spending is not a week of stale data. Before any success the grant's arrival stands in,
 * so a key issued a minute ago is not "stale" on the spot -- it becomes stale a day later,
 * which is right: nothing has run.
 */
export function describeSourceFreshness(
  state: AutoRunState | null,
  grantReceivedAtMs: number,
  nowMs: number,
  staleAfterMs: number,
): SourceFreshness {
  const lastOkAtMs = lastOkAtMsOf(state);
  const sinceMs = lastOkAtMs ?? grantReceivedAtMs;
  const staleForMs = Math.max(0, nowMs - sinceMs);
  return { lastOkAtMs, sinceMs, staleForMs, stale: staleForMs >= staleAfterMs };
}

export function shouldOpenAttentionPage(input: {
  staleCount: number;
  lastOpenedAtMs: number | null;
  nowMs: number;
  minIntervalMs?: number;
}): boolean {
  if (input.staleCount <= 0) return false;
  if (input.lastOpenedAtMs === null) return true;
  return (
    input.nowMs - input.lastOpenedAtMs >= (input.minIntervalMs ?? ATTENTION_PAGE_MIN_INTERVAL_MS)
  );
}

export function isRunRequestLive(
  requestedAtMs: unknown,
  nowMs: number,
  ttlMs: number = RUN_REQUEST_TTL_MS,
): boolean {
  if (typeof requestedAtMs !== "number" || !Number.isFinite(requestedAtMs)) return false;
  return nowMs - requestedAtMs < ttlMs;
}
