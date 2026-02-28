import { describe, expect, it } from "vitest";
import {
  validateTelemetryLogBatch,
  validateTelemetryLogEvent,
} from "@shared/lib/observability/schema";

describe("validateTelemetryLogEvent", () => {
  it("accepts a valid telemetry event", () => {
    const result = validateTelemetryLogEvent({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "ok",
      app: "api",
      component: "test",
      env: "local",
      release: "dev",
      trace_id: "0123456789abcdef0123456789abcdef",
      span_id: "0123456789abcdef",
      request_id: "req_123",
      attrs: { retries: 1, ok: true, extra: null },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects invalid payloads", () => {
    const result = validateTelemetryLogEvent({
      level: "bad",
      trace_id: "short",
      request_id: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("validateTelemetryLogBatch", () => {
  it("returns indexed errors for invalid records", () => {
    const result = validateTelemetryLogBatch([
      {
        timestamp: new Date().toISOString(),
        level: "info",
        message: "ok",
        app: "api",
        component: "test",
        env: "local",
        release: "dev",
        trace_id: "0123456789abcdef0123456789abcdef",
        request_id: "req_1",
      },
      { foo: "bar" },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.startsWith("events[1]:"))).toBe(true);
    }
  });
});
