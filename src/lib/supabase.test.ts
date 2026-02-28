import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createBrowserClientMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
  startClientSpanMock,
  spanEndMock,
} = vi.hoisted(() => ({
  createBrowserClientMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  startClientSpanMock: vi.fn(),
  spanEndMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: createBrowserClientMock,
}));

vi.mock("@/lib/observability/client-logger", () => ({
  createClientTelemetryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  })),
}));

vi.mock("@/lib/observability/client-tracer", () => ({
  startClientSpan: startClientSpanMock,
}));

async function setupCapturedFetch() {
  let capturedFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null =
    null;
  createBrowserClientMock.mockImplementation((_url: string, _key: string, options: unknown) => {
    capturedFetch = (options as { global?: { fetch?: typeof fetch } }).global?.fetch ?? null;
    return {} as unknown;
  });

  const { createClient } = await import("./supabase");
  createClient();

  expect(capturedFetch).toBeTruthy();
  return capturedFetch;
}

describe("createClient browser rpc instrumentation", () => {
  beforeEach(() => {
    createBrowserClientMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    startClientSpanMock.mockReset();
    spanEndMock.mockReset();
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
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("injects instrumented fetch into createBrowserClient and traces rpc calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const capturedFetch = await setupCapturedFetch();

    await capturedFetch?.("https://project.supabase.co/rest/v1/rpc/get_record_findings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("traceparent")).toBe(
      "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    );
    expect(headers.get("x-request-id")).toBe("req_123");
    expect(loggerInfoMock).toHaveBeenCalledWith(
      "supabase_rpc_started",
      expect.objectContaining({
        rpc_name: "get_record_findings",
      }),
      expect.any(Object),
    );
    expect(spanEndMock).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
  });

  it("bypasses span creation for non-rpc calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const capturedFetch = await setupCapturedFetch();
    await capturedFetch?.("https://project.supabase.co/rest/v1/medical_records", { method: "GET" });

    expect(startClientSpanMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves request correlation headers and marks non-ok rpc response as error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const capturedFetch = await setupCapturedFetch();

    const request = new Request("https://project.supabase.co/rest/v1/rpc/get_checkups", {
      method: "POST",
      headers: {
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        "x-request-id": "req_existing",
      },
    });
    await capturedFetch?.(request);

    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("traceparent")).toBe(
      "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    );
    expect(headers.get("x-request-id")).toBe("req_existing");
    expect(loggerWarnMock).toHaveBeenCalledWith(
      "supabase_rpc_failed",
      expect.objectContaining({
        rpc_name: "get_checkups",
        status_code: 503,
        ok: false,
      }),
      expect.any(Object),
    );
    expect(spanEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        statusMessage: "RPC returned 503",
      }),
    );
  });

  it("uses url input and reports unknown message for non-error rpc exception", async () => {
    const fetchMock = vi.fn().mockRejectedValue("boom");
    vi.stubGlobal("fetch", fetchMock);
    const capturedFetch = await setupCapturedFetch();

    await expect(
      capturedFetch?.(new URL("https://project.supabase.co/rest/v1/rpc/get_conditions"), {
        method: "POST",
      }),
    ).rejects.toBe("boom");
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "supabase_rpc_exception",
      expect.objectContaining({
        rpc_name: "get_conditions",
      }),
      expect.objectContaining({
        name: "SupabaseRpcFetchError",
        message: "Unknown RPC fetch error",
      }),
      expect.any(Object),
    );
    expect(spanEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        statusMessage: "Unknown RPC fetch error",
      }),
    );
  });
});
