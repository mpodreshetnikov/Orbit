import { describe, expect, it, vi } from "vitest";
import { createActiveRunRegistry } from "./active-runs.js";
import { keepWorkerAliveDuringRuns } from "./keepalive.js";

describe("keepalive", () => {
  it("pings only while a run is registered", () => {
    vi.useFakeTimers();
    try {
      const registry = createActiveRunRegistry();
      const ping = vi.fn();
      const stop = keepWorkerAliveDuringRuns(registry, { ping, intervalMs: 1000 });

      vi.advanceTimersByTime(5000);
      expect(ping).not.toHaveBeenCalled();

      registry.begin("s1");
      registry.begin("s2");
      vi.advanceTimersByTime(3000);
      expect(ping).toHaveBeenCalledTimes(3);

      // One run ending is not the end of the waiting.
      registry.end("s1");
      vi.advanceTimersByTime(1000);
      expect(ping).toHaveBeenCalledTimes(4);

      registry.end("s2");
      vi.advanceTimersByTime(5000);
      expect(ping).toHaveBeenCalledTimes(4);

      registry.begin("s3");
      stop();
      vi.advanceTimersByTime(5000);
      expect(ping).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps pinging past a ping that throws", () => {
    vi.useFakeTimers();
    try {
      const registry = createActiveRunRegistry();
      const ping = vi.fn(() => {
        throw new Error("no runtime");
      });
      keepWorkerAliveDuringRuns(registry, { ping, intervalMs: 1000 });
      registry.begin("s1");
      vi.advanceTimersByTime(2000);
      expect(ping).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
