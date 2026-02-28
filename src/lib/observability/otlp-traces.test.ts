import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("forwardTracesToOtlp", () => {
  const envSnapshot = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(envSnapshot)) {
      process.env[key] = value;
    }
  });

  function event(overrides: Record<string, unknown> = {}) {
    return {
      name: "http.request",
      app: "web",
      component: "api",
      env: "test",
      release: "r1",
      trace_id: "a".repeat(32),
      span_id: "b".repeat(16),
      request_id: "req_123456",
      start_time: "2026-02-28T00:00:00.000Z",
      end_time: "2026-02-28T00:00:01.000Z",
      ...overrides,
    };
  }

  it("throws when cloud endpoint is not configured", async () => {
    process.env.OBS_EXPORTER_MODE = "cloud";
    delete process.env.OBS_OTLP_TRACES_ENDPOINT;
    delete process.env.OBS_OTLP_ENDPOINT;

    const { forwardTracesToOtlp } = await import("./otlp-traces");
    await expect(forwardTracesToOtlp([event()])).rejects.toThrow(
      "OBS OTLP traces endpoint is not configured.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with response details when OTLP exporter returns non-ok", async () => {
    process.env.OBS_EXPORTER_MODE = "local";
    process.env.OBS_LOCAL_OTLP_HTTP_ENDPOINT = "http://collector:4318";
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue("collector unavailable"),
    });

    const { forwardTracesToOtlp } = await import("./otlp-traces");
    await expect(forwardTracesToOtlp([event()])).rejects.toThrow(
      "OTLP traces export failed (503): collector unavailable",
    );
  });

  it("exports trace events with mapped OTLP attributes", async () => {
    process.env.OBS_EXPORTER_MODE = "cloud";
    process.env.OBS_OTLP_TRACES_ENDPOINT = "https://otlp.example/";
    process.env.OBS_OTLP_HEADERS = "x-common=1";
    process.env.OBS_GRAFANA_CLOUD_OTLP_HEADERS = "x-cloud=2";
    process.env.OBS_APP = "orbit-web";
    process.env.OBS_ENV = "stage";
    process.env.OBS_RELEASE = "2026.2.28";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const { forwardTracesToOtlp } = await import("./otlp-traces");
    await forwardTracesToOtlp([
      event({
        kind: "server",
        status: "error",
        status_message: "failed",
        parent_span_id: "c".repeat(16),
        attrs: {
          boolAttr: true,
          numAttr: 3.14,
          strAttr: "value",
          nullAttr: null,
        },
      }),
      event({
        span_id: "d".repeat(16),
        request_id: "req_654321",
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://otlp.example/v1/traces");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-common": "1",
      "x-cloud": "2",
    });

    const body = JSON.parse(String(init.body));
    const spans = body.resourceSpans[0].scopeSpans[0].spans;
    expect(body.resourceSpans[0].resource.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "service.name", value: { stringValue: "orbit-web" } }),
        expect.objectContaining({
          key: "deployment.environment",
          value: { stringValue: "stage" },
        }),
        expect.objectContaining({
          key: "service.version",
          value: { stringValue: "2026.2.28" },
        }),
      ]),
    );

    expect(spans[0]).toEqual(
      expect.objectContaining({
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        parentSpanId: "c".repeat(16),
        kind: 2,
        status: {
          code: 2,
          message: "failed",
        },
      }),
    );
    expect(spans[0].attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "attrs.boolAttr", value: { boolValue: true } }),
        expect.objectContaining({ key: "attrs.numAttr", value: { doubleValue: 3.14 } }),
        expect.objectContaining({ key: "attrs.strAttr", value: { stringValue: "value" } }),
        expect.objectContaining({ key: "attrs.nullAttr", value: { stringValue: "null" } }),
      ]),
    );

    expect(spans[1].spanId).toBe("d".repeat(16));
    expect(spans[1].kind).toBe(1);
    expect(spans[1].status).toBeUndefined();
    expect(spans[1].parentSpanId).toBeUndefined();
  });
});
