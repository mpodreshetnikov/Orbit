import { describe, expect, it } from "vitest";
import {
  validateTelemetrySpanBatch,
  validateTelemetrySpanEvent,
} from "@shared/lib/observability/trace-schema";

describe("validateTelemetrySpanEvent", () => {
  it("accepts a valid telemetry span event", () => {
    const result = validateTelemetrySpanEvent({
      name: "web.supabase.rpc.get_record_observations",
      app: "web",
      component: "supabase-browser-client",
      env: "local",
      release: "dev-local",
      trace_id: "0123456789abcdef0123456789abcdef",
      span_id: "0123456789abcdef",
      parent_span_id: "abcdef0123456789",
      request_id: "req_123",
      start_time: new Date(Date.now() - 50).toISOString(),
      end_time: new Date().toISOString(),
      kind: "client",
      status: "ok",
      attrs: {
        rpc_name: "get_record_observations",
        status_code: 200,
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects invalid payloads", () => {
    const result = validateTelemetrySpanEvent({
      name: "",
      trace_id: "short",
      span_id: "bad",
      request_id: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("validateTelemetrySpanBatch", () => {
  it("returns indexed errors for invalid records", () => {
    const nowIso = new Date().toISOString();
    const result = validateTelemetrySpanBatch([
      {
        name: "valid.span",
        app: "web",
        component: "test",
        env: "local",
        release: "dev",
        trace_id: "0123456789abcdef0123456789abcdef",
        span_id: "0123456789abcdef",
        request_id: "req_1",
        start_time: nowIso,
        end_time: nowIso,
      },
      { foo: "bar" },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.startsWith("events[1]:"))).toBe(true);
    }
  });
});
