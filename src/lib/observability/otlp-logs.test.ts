import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("forwardLogsToOtlp", () => {
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
      timestamp: "2026-02-28T00:00:00.000Z",
      level: "info" as const,
      message: "server.log",
      app: "web",
      component: "api",
      env: "test",
      release: "r1",
      trace_id: "a".repeat(32),
      span_id: "b".repeat(16),
      request_id: "req_123456",
      ...overrides,
    };
  }

  it("throws when cloud endpoint is not configured", async () => {
    process.env.OBS_EXPORTER_MODE = "cloud";
    delete process.env.OBS_OTLP_LOGS_ENDPOINT;
    delete process.env.OBS_OTLP_ENDPOINT;

    const { forwardLogsToOtlp } = await import("./otlp-logs");
    await expect(forwardLogsToOtlp([event()])).rejects.toThrow(
      "OBS OTLP logs endpoint is not configured.",
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

    const { forwardLogsToOtlp } = await import("./otlp-logs");
    await expect(forwardLogsToOtlp([event()])).rejects.toThrow(
      "OTLP logs export failed (503): collector unavailable",
    );
  });

  it("exports log events with session, user, attrs, and error fields", async () => {
    process.env.OBS_EXPORTER_MODE = "cloud";
    process.env.OBS_OTLP_LOGS_ENDPOINT = "https://otlp.example/";
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

    const { forwardLogsToOtlp } = await import("./otlp-logs");
    await forwardLogsToOtlp([
      event({
        level: "error",
        session_id: "sess_1",
        user_id_hash: "userhash1",
        attrs: {
          boolAttr: true,
          numAttr: 3.14,
          strAttr: "value",
          nullAttr: null,
        },
        error: {
          name: "Boom",
          message: "failed",
          code: "E_FAIL",
          cause: "upstream",
        },
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://otlp.example/v1/logs");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-common": "1",
      "x-cloud": "2",
    });

    const body = JSON.parse(String(init.body));
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(body.resourceLogs[0].resource.attributes).toEqual(
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
    expect(record).toEqual(
      expect.objectContaining({
        severityNumber: 17,
        severityText: "ERROR",
        body: { stringValue: "server.log" },
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
      }),
    );
    expect(record.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "session_id", value: { stringValue: "sess_1" } }),
        expect.objectContaining({ key: "user_id_hash", value: { stringValue: "userhash1" } }),
        expect.objectContaining({ key: "attrs.boolAttr", value: { boolValue: true } }),
        expect.objectContaining({ key: "attrs.numAttr", value: { doubleValue: 3.14 } }),
        expect.objectContaining({ key: "attrs.strAttr", value: { stringValue: "value" } }),
        expect.objectContaining({ key: "attrs.nullAttr", value: { stringValue: "null" } }),
        expect.objectContaining({ key: "error.name", value: { stringValue: "Boom" } }),
        expect.objectContaining({ key: "error.message", value: { stringValue: "failed" } }),
        expect.objectContaining({ key: "error.code", value: { stringValue: "E_FAIL" } }),
        expect.objectContaining({ key: "error.cause", value: { stringValue: "upstream" } }),
      ]),
    );
  });
});
