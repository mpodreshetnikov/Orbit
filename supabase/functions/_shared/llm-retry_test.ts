// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import {
  backoffDelayMs,
  MAX_RETRY_AFTER_MS,
  isRetryableStatus,
  parseRetryAfterMs,
  RetryableLlmError,
  withLlmRetry,
} from "./llm-retry.ts";

const noSleep = async () => {};

Deno.test("only provider-side failures are classified as retryable", () => {
  assertEquals(isRetryableStatus(429), true);
  assertEquals(isRetryableStatus(500), true);
  assertEquals(isRetryableStatus(503), true);
  // Our own mistakes: a retry reaches the same answer and wastes quota.
  assertEquals(isRetryableStatus(400), false);
  assertEquals(isRetryableStatus(401), false);
  assertEquals(isRetryableStatus(404), false);
});

Deno.test("parseRetryAfterMs understands seconds and HTTP dates", () => {
  const now = Date.parse("2026-08-02T00:00:00Z");
  assertEquals(parseRetryAfterMs("2", now), 2000);
  assertEquals(parseRetryAfterMs("0", now), 0);
  assertEquals(parseRetryAfterMs("Sun, 02 Aug 2026 00:00:30 GMT", now), 30000);
  assertEquals(parseRetryAfterMs(null, now), null);
  assertEquals(parseRetryAfterMs("soon", now), null);
  // A date already in the past clamps to zero rather than going negative.
  assertEquals(parseRetryAfterMs("Sat, 01 Aug 2026 00:00:00 GMT", now), 0);
});

Deno.test("backoff grows exponentially and stays within the jitter band", () => {
  assertEquals(backoffDelayMs(0, 500, 0), 250);
  assertEquals(backoffDelayMs(0, 500, 1), 500);
  assertEquals(backoffDelayMs(1, 500, 0), 500);
  assertEquals(backoffDelayMs(2, 500, 1), 2000);
});

Deno.test("withLlmRetry returns immediately on success", async () => {
  let calls = 0;
  const result = await withLlmRetry(
    async () => {
      calls += 1;
      return "ok";
    },
    { sleepFn: noSleep },
  );
  assertEquals(result.value, "ok");
  assertEquals(result.attempts, 1);
  assertEquals(calls, 1);
});

Deno.test("withLlmRetry recovers after transient failures", async () => {
  let calls = 0;
  const result = await withLlmRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new RetryableLlmError("OpenRouter request failed: 429");
      return "recovered";
    },
    { sleepFn: noSleep, jitterFn: () => 0.5 },
  );
  assertEquals(result.value, "recovered");
  assertEquals(result.attempts, 3);
});

Deno.test("withLlmRetry does not retry a non-retryable failure", async () => {
  let calls = 0;
  let message = "";
  try {
    await withLlmRetry(
      async () => {
        calls += 1;
        throw new Error("OpenRouter request failed: 401");
      },
      { sleepFn: noSleep },
    );
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(calls, 1);
  assertEquals(message, "OpenRouter request failed: 401");
});

Deno.test("withLlmRetry gives up after the attempt limit and rethrows", async () => {
  let calls = 0;
  let message = "";
  try {
    await withLlmRetry(
      async () => {
        calls += 1;
        throw new RetryableLlmError("OpenRouter request failed: 500");
      },
      { sleepFn: noSleep, jitterFn: () => 0, maxAttempts: 3 },
    );
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(calls, 3);
  assertEquals(message, "OpenRouter request failed: 500");
});

Deno.test("withLlmRetry honours Retry-After over computed backoff", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withLlmRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new RetryableLlmError("rate limited", 1234);
      return "ok";
    },
    {
      sleepFn: async (ms) => {
        delays.push(ms);
      },
      jitterFn: () => 0,
    },
  );
  assertEquals(delays, [1234]);
});

Deno.test("withLlmRetry logs retries without including model output", async () => {
  const lines: string[] = [];
  let calls = 0;
  await withLlmRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new RetryableLlmError("OpenRouter request failed: 429");
      return "ok";
    },
    {
      sleepFn: noSleep,
      jitterFn: () => 0,
      log: {
        log: () => {},
        warn: (...args: unknown[]) => lines.push(String(args[0])),
        error: () => {},
      },
    },
  );
  assertEquals(lines.length, 1);
  assertEquals(lines[0].includes('"llm_retry":true'), true);
  assertEquals(lines[0].includes("429"), true);
});

// `Retry-After` is the provider's number and it is unbounded: an overloaded endpoint can ask for
// ten minutes. A worker that obeys sits idle past the lease saying it is alive, and its record is
// released out from under it.
Deno.test(
  "withLlmRetry will not wait longer than the cap, whatever the provider asks",
  async () => {
    const delays: number[] = [];
    let calls = 0;
    await withLlmRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new RetryableLlmError("rate limited", 10 * 60_000);
        return "ok";
      },
      {
        sleepFn: async (ms) => {
          delays.push(ms);
        },
        jitterFn: () => 0,
      },
    );
    assertEquals(delays, [MAX_RETRY_AFTER_MS]);
  },
);

// A stage that is retrying is a run that is alive but silent, and silence is what a lease reads
// as death. The hook is where a caller says otherwise.
Deno.test("withLlmRetry runs its hook after each backoff, before the next attempt", async () => {
  const order: string[] = [];
  let calls = 0;
  await withLlmRetry(
    async () => {
      order.push("attempt");
      calls += 1;
      if (calls < 3) throw new RetryableLlmError("rate limited");
      return "ok";
    },
    {
      sleepFn: async () => {
        order.push("sleep");
      },
      jitterFn: () => 0,
      onBeforeRetry: async () => {
        order.push("hook");
      },
    },
  );
  assertEquals(order, ["attempt", "sleep", "hook", "attempt", "sleep", "hook", "attempt"]);
});

Deno.test("a hook that throws abandons the retry rather than attempting again", async () => {
  let attempts = 0;
  let caught: unknown = null;
  try {
    await withLlmRetry(
      async () => {
        attempts += 1;
        throw new RetryableLlmError("rate limited");
      },
      {
        sleepFn: noSleep,
        jitterFn: () => 0,
        onBeforeRetry: async () => {
          throw new Error("claim lost");
        },
      },
    );
  } catch (error) {
    caught = error;
  }

  // The caller discovered mid-loop that the work is no longer theirs; nothing more is paid for.
  assertEquals((caught as Error).message, "claim lost");
  assertEquals(attempts, 1);
});
