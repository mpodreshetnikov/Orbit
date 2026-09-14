/**
 * The budget a browser request gets before the page stops waiting for it.
 *
 * The server answers these pages in well under a second; what has taken longer was a response
 * that never arrived (2026-09-14: the feed's fifty rows and a report's 484 rows, both sent by
 * the server in under 200 ms, sat in the browser for minutes while small answers came through
 * on the same path). An aborted request frees its socket, and a retry opens a fresh connection,
 * which on an unstable route may go another way; waiting would not.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/** When a page should say that the wait is unusual, before the budget runs out. */
export const SLOW_RESPONSE_AFTER_MS = 8_000;

function timeoutReason(ms: number): Error {
  const message = `no answer in ${ms} ms`;
  return typeof DOMException === "function"
    ? new DOMException(message, "TimeoutError")
    : Object.assign(new Error(message), { name: "TimeoutError" });
}

/**
 * A signal that aborts when `parent` does or when `ms` pass, whichever comes first. Written out
 * instead of `AbortSignal.any` so the older WebViews the app runs in are covered.
 */
export function timeoutSignal(
  ms: number = REQUEST_TIMEOUT_MS,
  parent?: AbortSignal | null,
): AbortSignal {
  const controller = new AbortController();
  if (parent?.aborted) {
    controller.abort(parent.reason);
    return controller.signal;
  }
  const timer = setTimeout(() => controller.abort(timeoutReason(ms)), ms);
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onParentAbort, { once: true });
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
    { once: true },
  );
  return controller.signal;
}

/**
 * Whether an error message from supabase-js means the request was cut off rather than answered:
 * the client reports a failed fetch as `${error.name}: ${error.message}`.
 */
export function isTimeoutMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && /^(TimeoutError|AbortError)\b/.test(message);
}
