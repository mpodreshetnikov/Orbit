import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createClientTelemetryLogger", () => {
  const envSnapshot = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });
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

  it("emits logs to default relay with environment defaults", async () => {
    process.env.NODE_ENV = "test";
    process.env.NEXT_PUBLIC_APP_VERSION = "v-test";

    const { createClientTelemetryLogger } = await import("./client-logger");
    const logger = createClientTelemetryLogger({ component: "dashboard" });

    const event = logger.info("client_hello", { source: "unit" });

    expect(event.app).toBe("web");
    expect(event.component).toBe("dashboard");
    expect(event.env).toBe("test");
    expect(event.release).toBe("v-test");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/observability/relay");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      events: [expect.objectContaining({ message: "client_hello", level: "info" })],
    });
  });

  it("supports custom options and error-level emission", async () => {
    const { createClientTelemetryLogger } = await import("./client-logger");
    const logger = createClientTelemetryLogger({
      app: "spa",
      component: "profile",
      env: "stage",
      release: "2026.2.28",
      relayPath: "/relay/custom",
      sessionId: "session-fixed",
      userIdHash: "hash_abcdef",
    });

    const event = logger.error(
      "client_failure",
      { action: "save" },
      { name: "SaveError", message: "failed" },
    );

    expect(event.app).toBe("spa");
    expect(event.env).toBe("stage");
    expect(event.release).toBe("2026.2.28");
    expect(event.session_id).toBe("session-fixed");
    expect(event.user_id_hash).toBe("hash_abcdef");
    expect(event.error).toEqual({ name: "SaveError", message: "failed" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/relay/custom");
    expect(JSON.parse(String(init.body)).events[0]).toEqual(
      expect.objectContaining({
        message: "client_failure",
        level: "error",
        session_id: "session-fixed",
      }),
    );
  });

  it("builds correlation with traceparent and keeps provided trace context", async () => {
    const { createClientTelemetryLogger } = await import("./client-logger");
    const logger = createClientTelemetryLogger({ component: "correlation-test" });
    const correlation = logger.correlation();

    expect(correlation.session_id).toBeTruthy();
    expect(correlation.trace_id).toMatch(/^[a-f0-9]{32}$/);
    expect(correlation.span_id).toMatch(/^[a-f0-9]{16}$/);
    expect(correlation.request_id).toMatch(/^req_/);
    expect(correlation.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);

    const emitted = logger.warn(
      "client_warning",
      { handled: true },
      {
        trace_id: correlation.trace_id,
        span_id: correlation.span_id,
        request_id: correlation.request_id,
      },
    );

    expect(emitted.trace_id).toBe(correlation.trace_id);
    expect(emitted.span_id).toBe(correlation.span_id);
    expect(emitted.request_id).toBe(correlation.request_id);
  });
});
