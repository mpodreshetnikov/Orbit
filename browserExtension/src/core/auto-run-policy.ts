/**
 * Decides whether an import may start on its own.
 *
 * Two things need protecting. Ordinary use of the bank site should not turn into an import on
 * every page load, so a successful run buys a long quiet period. And a user who is signed out
 * of the bank would otherwise produce a failed attempt on every visit, so failures widen the
 * gap and, after enough of them, stop automatic attempts until a manual run succeeds.
 *
 * Kept free of `chrome.*` so the decisions can be tested directly.
 */

/**
 * Who started a run: the sweep on its own, the sweep on a person's request from the attention
 * page, or a person by hand. A requested run is the person's doing, not an automatic one, and
 * is named so wherever the last run is described.
 */
export type AutoRunOrigin = "auto" | "manual" | "requested";

/**
 * The last attempt of any kind, kept apart from the backoff fields: a failed manual run is
 * recorded here for the page to show, without widening the automatic backoff -- the person's
 * own attempt says nothing the sweep should act on.
 */
export interface AutoRunAttempt {
  atMs: number;
  result: "ok" | "error";
  error: string | null;
  origin: AutoRunOrigin;
}

export interface AutoRunState {
  lastRunAtMs: number | null;
  lastResult: "ok" | "error" | null;
  consecutiveFailures: number;
  /**
   * What the last failed attempt said, so the import page can show it. Null after a success.
   * Optional because states written before it existed have no such field.
   */
  lastError?: string | null;
  /**
   * Who started the run the timestamp belongs to. A manual import resets the backoff and
   * buys the cooldown like an automatic one, but the page must not call it automatic.
   */
  lastRunOrigin?: AutoRunOrigin;
  /** The last attempt of any kind; see `AutoRunAttempt`. Optional: older states have none. */
  lastAttempt?: AutoRunAttempt | null;
  /**
   * When the last successful run was, kept across the failures that follow it. `lastRunAtMs`
   * is the last attempt of any kind, so after one failed attempt it said nothing about how
   * long the data had been stale -- and that is the question the attention page asks. Optional
   * because states written before it existed have no such field; see `lastOkAtMsOf`.
   */
  lastOkAtMs?: number | null;
}

/** When the next unattended run may start, as the import page tells it. */
export type AutoRunEligibility =
  | { kind: "now" }
  | { kind: "after"; atMs: number }
  | { kind: "stopped" };

export interface AutoRunOptions {
  cooldownMs?: number;
  maxConsecutiveFailures?: number;
}

/**
 * A successful run covers the day, with four hours to spare so a visit at roughly the same hour
 * the next day still counts rather than being turned away for being an hour early. That slack is
 * why the screen says "every 20 hours" and not "once a day": on a machine left running, two runs
 * can fall inside one calendar day, and promising otherwise would be promising what this does
 * not enforce.
 */
export const DEFAULT_AUTO_RUN_COOLDOWN_MS = 20 * 60 * 60 * 1000;
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export function createInitialAutoRunState(): AutoRunState {
  return {
    lastRunAtMs: null,
    lastResult: null,
    consecutiveFailures: 0,
    lastError: null,
    lastOkAtMs: null,
    lastAttempt: null,
  };
}

/**
 * The last attempt on record. A state written before the field existed carries it in the
 * backoff fields, which know nothing of a failed manual run that came after a success.
 */
export function lastAttemptOf(state: AutoRunState | null): AutoRunAttempt | null {
  if (!state) return null;
  if (state.lastAttempt) return state.lastAttempt;
  if (state.lastRunAtMs === null || state.lastResult === null) return null;
  return {
    atMs: state.lastRunAtMs,
    result: state.lastResult,
    error: state.lastResult === "error" ? (state.lastError ?? null) : null,
    origin: state.lastRunOrigin ?? "auto",
  };
}

/**
 * Records a failed attempt without touching the backoff: a person's own run that failed is
 * shown as the last attempt, and the sweep's schedule is left as it was.
 */
export function withFailedAttempt(
  state: AutoRunState | null,
  nowMs: number,
  error: string | null,
  origin: AutoRunOrigin,
): AutoRunState {
  return {
    ...(state ?? createInitialAutoRunState()),
    lastAttempt: { atMs: nowMs, result: "error", error, origin },
  };
}

/**
 * The last success on record. A state written before the field existed carries it in
 * `lastRunAtMs` when that run succeeded, and has lost it when a failure came after.
 */
export function lastOkAtMsOf(state: AutoRunState | null): number | null {
  if (!state) return null;
  if (typeof state.lastOkAtMs === "number") return state.lastOkAtMs;
  return state.lastResult === "ok" ? state.lastRunAtMs : null;
}

/**
 * One reading of the state for both the sweep and the import page, so what the page says the
 * extension will do is what the sweep decides.
 */
export function describeAutoRunEligibility(
  state: AutoRunState | null,
  nowMs: number,
  options: AutoRunOptions = {},
): AutoRunEligibility {
  const cooldownMs = options.cooldownMs ?? DEFAULT_AUTO_RUN_COOLDOWN_MS;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;

  if (!state || state.lastRunAtMs === null) return { kind: "now" };
  if (state.consecutiveFailures >= maxConsecutiveFailures) return { kind: "stopped" };

  // Each failure doubles the wait, so a signed-out session costs one attempt, then one every
  // two days, then nothing until a manual run clears the count.
  const backoffFactor = 2 ** Math.max(0, state.consecutiveFailures - 1);
  const effectiveCooldownMs =
    state.lastResult === "error" ? cooldownMs * backoffFactor : cooldownMs;
  const atMs = state.lastRunAtMs + effectiveCooldownMs;

  // A cooldown that has passed is not "after": the page would otherwise show a receding
  // timestamp for a run the sweep is already allowed to make.
  return nowMs >= atMs ? { kind: "now" } : { kind: "after", atMs };
}

export function shouldAutoRun(
  state: AutoRunState | null,
  nowMs: number,
  options: AutoRunOptions = {},
): boolean {
  return describeAutoRunEligibility(state, nowMs, options).kind === "now";
}

export function nextAutoRunState(
  state: AutoRunState | null,
  nowMs: number,
  result: "ok" | "error",
  error: string | null = null,
  origin: AutoRunOrigin = "auto",
): AutoRunState {
  const previousFailures = state?.consecutiveFailures ?? 0;
  const lastError = result === "ok" ? null : (error ?? state?.lastError ?? null);
  return {
    lastRunAtMs: nowMs,
    lastResult: result,
    consecutiveFailures: result === "ok" ? 0 : previousFailures + 1,
    lastError,
    lastRunOrigin: origin,
    lastOkAtMs: result === "ok" ? nowMs : lastOkAtMsOf(state),
    lastAttempt: { atMs: nowMs, result, error: lastError, origin },
  };
}
