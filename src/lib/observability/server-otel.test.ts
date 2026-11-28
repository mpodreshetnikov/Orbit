import { ROOT_CONTEXT, propagation, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { core } from "@opentelemetry/sdk-node";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startNodeOtel } from "./server-otel";

vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: vi.fn(() => []),
}));

vi.mock("@opentelemetry/sdk-node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@opentelemetry/sdk-node")>()),
  NodeSDK: class {
    start() {}
  },
}));

const caller = {
  traceId: "a".repeat(32),
  spanId: "1".repeat(16),
  traceFlags: 1,
  isRemote: true,
};

describe("MCP HTTP trace propagation", () => {
  beforeEach(async () => {
    expect(propagation.setGlobalPropagator(new core.W3CTraceContextPropagator())).toBe(true);
    await startNodeOtel();
  });

  afterEach(() => {
    propagation.disable();
    globalThis.__orbitNodeOtelStarted = undefined;
    globalThis.__orbitNodeOtelSdk = undefined;
  });

  function startIncomingSpan(url: string | undefined, headers: IncomingMessage["headers"]) {
    const request = new IncomingMessage(new Socket());
    request.url = url;
    request.headers = { ...headers };
    const config = vi.mocked(getNodeAutoInstrumentations).mock.lastCall?.[0];
    const attributes =
      config?.["@opentelemetry/instrumentation-http"]?.startIncomingSpanHook?.(request);
    return { attributes, headers: request.headers };
  }

  const incoming = {
    traceparent: `00-${caller.traceId}-${caller.spanId}-01`,
    tracestate: "synthetic=test",
    baggage: "synthetic=test",
    authorization: "Bearer synthetic",
  };

  it.each(["/api/mcp", "/api/mcp?synthetic=1", "/api/mcp/"])(
    "removes the caller parent before extraction for %s and retains its trace ID",
    (url) => {
      const result = startIncomingSpan(url, incoming);
      expect(
        trace.getSpanContext(propagation.extract(ROOT_CONTEXT, result.headers)),
      ).toBeUndefined();
      expect(result.headers).toEqual({
        baggage: incoming.baggage,
        authorization: incoming.authorization,
      });
      expect(result.attributes).toEqual({ "orbit.mcp.caller_trace_id": caller.traceId });
    },
  );

  it.each(["/api/mcp-probe", "/api/mcp/tools", "/api/other?path=/api/mcp", undefined])(
    "preserves propagation for %s",
    (url) => {
      const result = startIncomingSpan(url, incoming);
      expect(result.headers).toEqual(incoming);
      expect(result.attributes).toEqual({});
      const parent = trace.getSpanContext(propagation.extract(ROOT_CONTEXT, result.headers));
      expect(parent).toMatchObject(caller);
      expect(parent?.traceState?.serialize()).toBe(incoming.tracestate);
    },
  );

  it.each([undefined, "malformed"])("omits correlation for traceparent %s", (traceparent) => {
    const result = startIncomingSpan("/api/mcp", { traceparent, tracestate: incoming.tracestate });
    expect(result.headers).toEqual({});
    expect(result.attributes).toEqual({});
  });
});
