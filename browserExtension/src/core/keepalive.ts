import type { ActiveRunRegistry } from "./active-runs.js";

/**
 * Chrome ends an extension service worker after thirty seconds without an event or an
 * extension API call. An import waits on the bank's rate limit through plain timers, which
 * count for nothing -- a run that paused long enough was simply gone, with its session left
 * behind as if it were still running (2026-09-03).
 */
export const KEEPALIVE_INTERVAL_MS = 20_000;

export interface KeepaliveDeps {
  /** Any extension API call will do; the answer is not used. */
  ping: () => unknown;
  intervalMs?: number;
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/**
 * Pings while at least one run is registered, and stops the moment none is: the worker may
 * idle only when nothing of ours is waiting on a timer. Returns the unsubscribe.
 */
export function keepWorkerAliveDuringRuns(
  registry: ActiveRunRegistry,
  deps: KeepaliveDeps,
): () => void {
  const setTimer = deps.setInterval ?? ((handler, ms) => setInterval(handler, ms));
  const clearTimer = deps.clearInterval ?? ((handle) => clearInterval(handle as number));
  const intervalMs = deps.intervalMs ?? KEEPALIVE_INTERVAL_MS;
  let handle: unknown = null;

  const apply = (size: number) => {
    if (size > 0 && handle === null) {
      handle = setTimer(() => {
        try {
          void deps.ping();
        } catch {
          // A failed ping is a ping; the next one comes on schedule.
        }
      }, intervalMs);
    } else if (size === 0 && handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  apply(registry.size());
  const unsubscribe = registry.onChange(apply);
  return () => {
    unsubscribe();
    apply(0);
  };
}
