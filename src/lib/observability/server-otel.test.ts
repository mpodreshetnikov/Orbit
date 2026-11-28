import { context, propagation, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { core, node, NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveTraceContext,
  shutdownNodeOtel,
  startNodeOtel,
  withServerSpan,
} from "./server-otel";

vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: vi.fn(() => []),
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: vi.fn(class {}),
}));

vi.mock("@opentelemetry/sdk-node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@opentelemetry/sdk-node")>()),
  NodeSDK: vi.fn(
    class {
      start = vi.fn();
      shutdown = vi.fn(async () => {});
    },
  ),
}));

afterEach(() => {
  globalThis.__orbitNodeOtelStarted = undefined;
  globalThis.__orbitNodeOtelSdk = undefined;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

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

describe("Node tracing SDK", () => {
  it("wires the configured OTLP destination, identity and instrumentation into the SDK", async () => {
    vi.stubEnv("OBS_EXPORTER_MODE", "local");
    vi.stubEnv("OBS_LOCAL_OTLP_HTTP_ENDPOINT", "http://collector.invalid:4318");
    vi.stubEnv("OBS_OTLP_HEADERS", "x-test=synthetic");
    vi.stubEnv("OBS_APP", "orbit-test");
    vi.stubEnv("OBS_ENV", "test");
    vi.stubEnv("OBS_RELEASE", "test-release");

    await startNodeOtel();

    expect(OTLPTraceExporter).toHaveBeenCalledExactlyOnceWith({
      url: "http://collector.invalid:4318/v1/traces",
      headers: { "x-test": "synthetic" },
    });
    const options = vi.mocked(NodeSDK).mock.lastCall?.[0];
    expect(options?.traceExporter).toBe(vi.mocked(OTLPTraceExporter).mock.instances[0]);
    expect(options?.resource?.attributes).toEqual({
      "service.name": "orbit-test",
      "deployment.environment": "test",
      "service.version": "test-release",
    });
    const instrumentation = vi.mocked(getNodeAutoInstrumentations).mock.lastCall?.[0];
    expect(instrumentation?.["@opentelemetry/instrumentation-winston"]).toEqual({
      enabled: false,
    });
  });

  it("starts once, shuts down once, and reuses the SDK on restart", async () => {
    await shutdownNodeOtel();
    await startNodeOtel();
    const sdk = vi.mocked(NodeSDK).mock.instances[0];

    await startNodeOtel();
    expect(NodeSDK).toHaveBeenCalledTimes(1);
    expect(sdk.start).toHaveBeenCalledTimes(1);

    await shutdownNodeOtel();
    await shutdownNodeOtel();
    expect(sdk.shutdown).toHaveBeenCalledTimes(1);
    expect(globalThis.__orbitNodeOtelStarted).toBe(false);

    await startNodeOtel();
    expect(NodeSDK).toHaveBeenCalledTimes(1);
    expect(sdk.start).toHaveBeenCalledTimes(2);
  });
});

describe("server spans", () => {
  let exporter: tracing.InMemorySpanExporter;
  let provider: node.NodeTracerProvider;

  beforeEach(() => {
    exporter = new tracing.InMemorySpanExporter();
    provider = new node.NodeTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    trace.disable();
    context.disable();
    propagation.disable();
    await provider.shutdown();
  });

  it("exposes the active span IDs and exports the successful span", async () => {
    expect(getActiveTraceContext()).toStrictEqual({});

    const result = await withServerSpan("synthetic.success", async () => {
      await Promise.resolve();
      return { value: "result", ids: getActiveTraceContext() };
    });

    const [span] = exporter.getFinishedSpans();
    expect(span).toMatchObject({
      name: "synthetic.success",
      instrumentationScope: { name: "orbit.server" },
    });
    expect(span.status).toStrictEqual({ code: SpanStatusCode.OK });
    expect(result).toStrictEqual({
      value: "result",
      ids: {
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId,
      },
    });
    expect(getActiveTraceContext()).toStrictEqual({});
  });

  it.each([
    {
      error: new Error("synthetic failure"),
      statusMessage: "synthetic failure",
      exceptionMessage: "synthetic failure",
    },
    {
      error: "synthetic rejection",
      statusMessage: "unknown error",
      exceptionMessage: "synthetic rejection",
    },
  ])(
    "records and rethrows a rejection with status message $statusMessage",
    async ({ error, statusMessage, exceptionMessage }) => {
      const operation = withServerSpan("synthetic.failure", async () => {
        throw error;
      });

      await expect(operation).rejects.toBe(error);
      const [span] = exporter.getFinishedSpans();
      expect(span.status).toStrictEqual({ code: SpanStatusCode.ERROR, message: statusMessage });
      expect(span.events).toMatchObject([
        { name: "exception", attributes: { "exception.message": exceptionMessage } },
      ]);
    },
  );
});
