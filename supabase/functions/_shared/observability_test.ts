import { assertEquals } from "std/assert/assert-equals";
import { createEdgeRequestContext, createEdgeTelemetry } from "./observability.ts";

Deno.test("createEdgeRequestContext preserves incoming traceparent and request id", () => {
  const traceId = "0123456789abcdef0123456789abcdef";
  const parentSpanId = "89abcdef01234567";
  const req = new Request("http://localhost/functions/v1/test", {
    headers: {
      traceparent: `00-${traceId}-${parentSpanId}-01`,
      "x-request-id": "req_existing_123",
    },
  });

  const context = createEdgeRequestContext(req, "test-function");

  assertEquals(context.component, "test-function");
  assertEquals(context.traceId, traceId);
  assertEquals(context.parentSpanId, parentSpanId);
  assertEquals(context.requestId, "req_existing_123");
});

Deno.test("createEdgeRequestContext generates ids when headers are missing or malformed", () => {
  const req = new Request("http://localhost/functions/v1/test", {
    headers: {
      traceparent: "malformed-traceparent",
    },
  });

  const context = createEdgeRequestContext(req, "test-function");

  assertEquals(/^[a-f0-9]{32}$/.test(context.traceId), true);
  assertEquals(context.parentSpanId, undefined);
  assertEquals(/^edge_[a-f0-9]{16}$/.test(context.requestId), true);
});

Deno.test("edge telemetry span end is best-effort when OTLP exporter fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("otlp unavailable"));

  try {
    const context = createEdgeRequestContext(new Request("http://localhost"), "test-function");
    const telemetry = createEdgeTelemetry(context);
    const span = telemetry.startSpan("edge.test.request", { kind: "server" });

    assertEquals(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/.test(span.traceparent), true);
    await span.end({ status: "error", statusMessage: "forced failure path" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
