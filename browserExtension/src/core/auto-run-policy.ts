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

export interface AutoRunState {
  lastRunAtMs: number | null;
  lastResult: "ok" | "error" | null;
  consecutiveFailures: number;
}

export interface AutoRunOptions {
  cooldownMs?: number;
  maxConsecutiveFailures?: number;
}

/** A successful run covers the day; a visit the next day is what should pick things up. */
export const DEFAULT_AUTO_RUN_COOLDOWN_MS = 20 * 60 * 60 * 1000;
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export function createInitialAutoRunState(): AutoRunState {
  return { lastRunAtMs: null, lastResult: null, consecutiveFailures: 0 };
}

export function shouldAutoRun(
  state: AutoRunState | null,
  nowMs: number,
  options: AutoRunOptions = {},
): boolean {
  const cooldownMs = options.cooldownMs ?? DEFAULT_AUTO_RUN_COOLDOWN_MS;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;

  if (!state || state.lastRunAtMs === null) return true;
  if (state.consecutiveFailures >= maxConsecutiveFailures) return false;

  // Each failure doubles the wait, so a signed-out session costs one attempt, then one every
  // two days, then nothing until a manual run clears the count.
  const backoffFactor = 2 ** Math.max(0, state.consecutiveFailures - 1);
  const effectiveCooldownMs =
    state.lastResult === "error" ? cooldownMs * backoffFactor : cooldownMs;

  return nowMs - state.lastRunAtMs >= effectiveCooldownMs;
}

export function nextAutoRunState(
  state: AutoRunState | null,
  nowMs: number,
  result: "ok" | "error",
): AutoRunState {
  const previousFailures = state?.consecutiveFailures ?? 0;
  return {
    lastRunAtMs: nowMs,
    lastResult: result,
    consecutiveFailures: result === "ok" ? 0 : previousFailures + 1,
  };
}
