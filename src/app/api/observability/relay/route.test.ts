import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerLoggerMock, forwardLogsToOtlpMock, generateRequestIdMock, loggerMocks } =
  vi.hoisted(() => ({
    createServerLoggerMock: vi.fn(),
    forwardLogsToOtlpMock: vi.fn(),
    generateRequestIdMock: vi.fn(() => "generated-req-id"),
    loggerMocks: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

vi.mock("@/lib/observability/server-logger", () => ({
  createServerLogger: createServerLoggerMock,
}));

vi.mock("@/lib/observability/otlp-logs", () => ({
  forwardLogsToOtlp: forwardLogsToOtlpMock,
}));

vi.mock("@shared/lib/observability/correlation", () => ({
  generateRequestId: generateRequestIdMock,
}));

function validLogEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-02-28T00:00:00.000Z",
    level: "info",
    message: "relay.log",
    app: "web",
    component: "client",
    env: "test",
    release: "r1",
    trace_id: "a".repeat(32),
    span_id: "b".repeat(16),
    request_id: "req_123456",
    attrs: {
      bool: true,
      num: 1,
      str: "x",
      nullable: null,
    },
    ...overrides,
  };
}

function relayRequest(body: string, headers?: Record<string, string>) {
  return new Request("http://localhost/api/observability/relay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body,
  });
}

describe("POST /api/observability/relay", () => {
  beforeEach(() => {
    createServerLoggerMock.mockReset();
    forwardLogsToOtlpMock.mockReset();
    generateRequestIdMock.mockClear();
    loggerMocks.info.mockReset();
    loggerMocks.warn.mockReset();
    loggerMocks.error.mockReset();
    createServerLoggerMock.mockReturnValue(loggerMocks);
  });

  it("rejects oversized payloads", async () => {
    const { POST } = await import("./route");
    const response = await POST(relayRequest("x".repeat(256 * 1024 + 1)));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Payload too large." });
    expect(loggerMocks.warn).toHaveBeenCalledWith("observability_relay_payload_too_large", {
      payload_bytes: 256 * 1024 + 1,
    });
  });

  it("rejects invalid json payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(relayRequest("{not-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON payload." });
    expect(loggerMocks.warn).toHaveBeenCalledWith("observability_relay_invalid_json");
  });

  it("rejects forbidden fields in nested payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      relayRequest(
        JSON.stringify({
          events: [validLogEvent(), { payload: { secret: "hidden" } }],
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Payload contains forbidden field "events[1].payload.secret".',
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith("observability_relay_forbidden_field", {
      forbidden_path: "events[1].payload.secret",
    });
  });

  it("rejects unsupported payload shapes", async () => {
    const { POST } = await import("./route");
    const response = await POST(relayRequest(JSON.stringify({ logs: [validLogEvent()] })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "Expected payload shape { events: TelemetryLogEvent[] } or { event: TelemetryLogEvent }.",
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith("observability_relay_invalid_shape");
  });

  it("rejects invalid batch sizes", async () => {
    const { POST } = await import("./route");

    const emptyResponse = await POST(relayRequest(JSON.stringify({ events: [] })));
    expect(emptyResponse.status).toBe(400);
    await expect(emptyResponse.json()).resolves.toEqual({
      error: "events length must be between 1 and 100.",
    });

    const hugeBatch = Array.from({ length: 101 }, (_, index) =>
      validLogEvent({ request_id: `req_123456_${index}` }),
    );
    const hugeResponse = await POST(relayRequest(JSON.stringify({ events: hugeBatch })));
    expect(hugeResponse.status).toBe(400);
    await expect(hugeResponse.json()).resolves.toEqual({
      error: "events length must be between 1 and 100.",
    });
  });

  it("returns validation errors for malformed telemetry events", async () => {
    const { POST } = await import("./route");
    const response = await POST(relayRequest(JSON.stringify({ events: [{ message: "missing" }] })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Telemetry validation failed.");
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('events[0]: Field "timestamp" must be a non-empty string.'),
      ]),
    );
    expect(loggerMocks.warn).toHaveBeenCalledWith("observability_relay_validation_failed", {
      error_count: expect.any(Number),
    });
  });

  it("returns 202 when otlp forwarding fails with non-error values", async () => {
    forwardLogsToOtlpMock.mockRejectedValueOnce("boom");
    const { POST } = await import("./route");
    const response = await POST(relayRequest(JSON.stringify({ events: [validLogEvent()] })));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      degraded: true,
      accepted: 1,
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith("observability_relay_otlp_forward_failed", {
      error_name: "OtlpForwardError",
      error_message: "Unknown OTLP forwarding error",
    });
  });

  it("forwards a single-event payload and uses generated request id when missing", async () => {
    forwardLogsToOtlpMock.mockResolvedValueOnce(undefined);
    const { POST } = await import("./route");
    const event = validLogEvent();
    const response = await POST(relayRequest(JSON.stringify({ event })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, accepted: 1 });
    expect(forwardLogsToOtlpMock).toHaveBeenCalledWith([event]);
    expect(createServerLoggerMock).toHaveBeenCalledWith({
      component: "observability-relay",
      requestId: "generated-req-id",
    });
    expect(generateRequestIdMock).toHaveBeenCalled();
    expect(loggerMocks.info).toHaveBeenCalledWith("observability_relay_forwarded", {
      accepted: 1,
    });
  });

  it("uses provided x-request-id header", async () => {
    forwardLogsToOtlpMock.mockResolvedValueOnce(undefined);
    const { POST } = await import("./route");
    const response = await POST(
      relayRequest(JSON.stringify([validLogEvent()]), { "x-request-id": "header-req-id" }),
    );

    expect(response.status).toBe(200);
    expect(createServerLoggerMock).toHaveBeenCalledWith({
      component: "observability-relay",
      requestId: "header-req-id",
    });
  });
});
