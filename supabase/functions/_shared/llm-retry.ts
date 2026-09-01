/**
 * Retry policy for model calls.
 *
 * A single 429 or a provider hiccup used to fail an entire record. Retrying is worth it only for
 * failures that are actually transient, so the classification here is deliberate:
 *
 * - 429 and 5xx are the provider's problem and are retried.
 * - Network failures and timeouts are retried.
 * - Truncation is retried, because a retry can ask for a larger completion budget.
 * - Every other 4xx is our problem — a bad key, a malformed body, an unsupported parameter — and
 *   retrying it just burns quota and latency to arrive at the same answer.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injected so tests do not actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Injected so backoff jitter is deterministic under test. */
  jitterFn?: () => number;
  log?: Pick<Console, "log" | "warn" | "error">;
  /** Cap on the delay between attempts, however long the provider asked for. */
  maxRetryAfterMs?: number;
  /** Run after each backoff and before the next attempt; throwing abandons the retry. */
  onBeforeRetry?: (attempt: number) => Promise<void>;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export class RetryableLlmError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "RetryableLlmError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Parse a Retry-After header, which may be seconds or an HTTP date.
 * Returns null when absent or unparseable so the caller falls back to computed backoff.
 */
export function parseRetryAfterMs(headerValue: string | null, nowMs: number): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - nowMs);

  return null;
}

/**
 * The longest a provider may make us wait between attempts.
 *
 * `Retry-After` is a provider's number, not ours, and it is unbounded: an overloaded endpoint can
 * ask for ten minutes. Obeying that silently means a worker holding a record's claim sits idle
 * past the lease that says it is alive, and the record is released out from under it. Waiting
 * less than asked risks another rate-limited attempt, which is the cheaper mistake.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Exponential backoff with full jitter, so concurrent retries do not resynchronise. */
export function backoffDelayMs(attempt: number, baseDelayMs: number, jitter: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  return Math.round(exponential * (0.5 + jitter * 0.5));
}

/**
 * Run `operation`, retrying only failures it reports as retryable by throwing RetryableLlmError.
 * Anything else propagates immediately.
 */
export async function withLlmRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<{ value: T; attempts: number }> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleepFn ?? defaultSleep;
  const jitter = options.jitterFn ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof RetryableLlmError;
      const hasNextAttempt = attempt < maxAttempts - 1;
      if (!retryable || !hasNextAttempt) break;

      const requested = error.retryAfterMs ?? backoffDelayMs(attempt, baseDelayMs, jitter());
      const delay = Math.min(requested, options.maxRetryAfterMs ?? MAX_RETRY_AFTER_MS);
      options.log?.warn?.(
        JSON.stringify({
          llm_retry: true,
          attempt: attempt + 1,
          max_attempts: maxAttempts,
          delay_ms: delay,
          // The message is one of our own fixed strings, never model output.
          reason: error.message,
        }),
      );
      await sleep(delay);
      // After the wait, before the next attempt: whatever the caller has to do to stay alive
      // while this loop is idle. Throwing here abandons the retry, which is the point when the
      // caller discovers it no longer owns the work.
      await options.onBeforeRetry?.(attempt + 1);
    }
  }

  throw lastError;
}
