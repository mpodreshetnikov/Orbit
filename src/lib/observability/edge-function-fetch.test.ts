import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerInfoMock, loggerWarnMock, loggerErrorMock, startClientSpanMock, spanEndMock } =
  vi.hoisted(() => ({
    loggerInfoMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    startClientSpanMock: vi.fn(),
    spanEndMock: vi.fn(),
  }));

vi.mock("./client-logger", () => ({
  createClientTelemetryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  })),
}));

vi.mock("./client-tracer", () => ({
  startClientSpan: startClientSpanMock,
}));

describe("fetchEdgeFunctionWithTelemetry", () => {
  beforeEach(() => {
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    spanEndMock.mockReset();
    startClientSpanMock.mockReset();
    startClientSpanMock.mockReturnValue({
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "0123456789abcdef",
      requestId: "req_123",
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      headers: {
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        "x-request-id": "req_123",
      },
      end: spanEndMock,
    });
  });

  it("injects traceparent and x-request-id headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchEdgeFunctionWithTelemetry } = await import("./edge-function-fetch");

    await fetchEdgeFunctionWithTelemetry(
      "https://project.supabase.co/functions/v1/health-ocr",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
      {
        component: "test-component",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("traceparent")).toBe(
      "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    );
    expect(headers.get("x-request-id")).toBe("req_123");
    expect(spanEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ok",
      }),
    );
  });

  it("marks span as error for non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 500 })));
    const { fetchEdgeFunctionWithTelemetry } = await import("./edge-function-fetch");

    await fetchEdgeFunctionWithTelemetry(
      "https://project.supabase.co/functions/v1/icd-lookup",
      { method: "POST" },
      { component: "test-component" },
    );

    expect(loggerWarnMock).toHaveBeenCalledWith(
      "edge_function_request_failed",
      expect.objectContaining({ status_code: 500 }),
      expect.any(Object),
    );
    expect(spanEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
      }),
    );
  });

  it("marks span as error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { fetchEdgeFunctionWithTelemetry } = await import("./edge-function-fetch");

    await expect(
      fetchEdgeFunctionWithTelemetry(
        "https://project.supabase.co/functions/v1/health-structure",
        { method: "POST" },
        { component: "test-component" },
      ),
    ).rejects.toThrow("network down");

    expect(loggerErrorMock).toHaveBeenCalledWith(
      "edge_function_request_exception",
      expect.any(Object),
      expect.objectContaining({
        name: "EdgeFunctionRequestError",
      }),
      expect.any(Object),
    );
    expect(spanEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
      }),
    );
  });
});
