import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTimeoutMessage, timeoutSignal } from "./request-timeout";

describe("timeoutSignal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts with a TimeoutError once the budget runs out", () => {
    const signal = timeoutSignal(1_000);

    vi.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe("TimeoutError");
  });

  it("follows the parent signal and drops its own timer", () => {
    const parent = new AbortController();
    const signal = timeoutSignal(1_000, parent.signal);

    parent.abort(new Error("gone"));

    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("gone");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is aborted at once when the parent already is", () => {
    const parent = new AbortController();
    parent.abort(new Error("earlier"));

    const signal = timeoutSignal(1_000, parent.signal);

    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("earlier");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("isTimeoutMessage", () => {
  it("recognises the client's report of a cut-off request and nothing else", () => {
    expect(isTimeoutMessage("TimeoutError: no answer in 20000 ms")).toBe(true);
    expect(isTimeoutMessage("AbortError: signal is aborted without reason")).toBe(true);
    expect(isTimeoutMessage("permission denied for table money_transactions")).toBe(false);
    expect(isTimeoutMessage(null)).toBe(false);
    expect(isTimeoutMessage(undefined)).toBe(false);
  });
});
