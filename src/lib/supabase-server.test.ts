import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createServerClientMock,
  cookiesMock,
  withServerSpanMock,
  getActiveTraceContextMock,
  createServerLoggerMock,
  generateRequestIdMock,
  createTraceparentMock,
  loggerMocks,
} = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  cookiesMock: vi.fn(),
  withServerSpanMock: vi.fn(),
  getActiveTraceContextMock: vi.fn(),
  createServerLoggerMock: vi.fn(),
  generateRequestIdMock: vi.fn(() => "generated-req-id"),
  createTraceparentMock: vi.fn((traceId: string, spanId: string) => `00-${traceId}-${spanId}-01`),
  loggerMocks: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/observability/server-otel", () => ({
  withServerSpan: withServerSpanMock,
  getActiveTraceContext: getActiveTraceContextMock,
}));

vi.mock("@/lib/observability/server-logger", () => ({
  createServerLogger: createServerLoggerMock,
}));

vi.mock("@shared/lib/observability/correlation", () => ({
  generateRequestId: generateRequestIdMock,
  createTraceparent: createTraceparentMock,
}));

describe("supabase-server helpers", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    cookiesMock.mockReset();
    withServerSpanMock.mockReset();
    getActiveTraceContextMock.mockReset();
    createServerLoggerMock.mockReset();
    generateRequestIdMock.mockClear();
    createTraceparentMock.mockClear();
    loggerMocks.info.mockReset();
    loggerMocks.warn.mockReset();
    loggerMocks.error.mockReset();

    cookiesMock.mockResolvedValue({
      getAll: () => [],
      set: vi.fn(),
    });
    createServerLoggerMock.mockReturnValue(loggerMocks);
    withServerSpanMock.mockImplementation(async (_name: string, run: () => Promise<unknown>) =>
      run(),
    );
    getActiveTraceContextMock.mockReturnValue({
      trace_id: "a".repeat(32),
      span_id: "b".repeat(16),
    });
  });

  it("getCurrentUser returns null when auth user lookup fails", async () => {
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("unauthorized"),
        }),
      },
    });

    const { getCurrentUser } = await import("./supabase-server");
    await expect(getCurrentUser()).resolves.toBeNull();
  }, 15000);

  it("getCurrentUser returns the authenticated user", async () => {
    const user = { id: "auth-user-1", email: "user@example.com" };
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user },
          error: null,
        }),
      },
    });

    const { getCurrentUser } = await import("./supabase-server");
    await expect(getCurrentUser()).resolves.toEqual(user);
  });

  it("isUserAllowed returns false for unauthenticated user", async () => {
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("unauthorized"),
        }),
      },
    });

    const { isUserAllowed } = await import("./supabase-server");
    await expect(isUserAllowed()).resolves.toBe(false);
  });

  it("isUserAllowed returns true for allowlisted user", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "allow-1" },
      error: null,
    });
    const or = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ or }));

    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "auth-user-1", email: "user@example.com" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({ select })),
    });

    const { isUserAllowed } = await import("./supabase-server");
    await expect(isUserAllowed()).resolves.toBe(true);
  });

  it("isUserAllowed returns false when the allowlist miss", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "no rows" },
    });
    const or = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ or }));

    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "auth-user-1", email: "user@example.com" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({ select })),
    });

    const { isUserAllowed } = await import("./supabase-server");
    await expect(isUserAllowed()).resolves.toBe(false);
  });
});

describe("createInstrumentedServerFetch", () => {
  let instrumentedFetch: typeof fetch;
  let baseFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createServerClientMock.mockReset();
    cookiesMock.mockReset();
    withServerSpanMock.mockReset();
    getActiveTraceContextMock.mockReset();
    createServerLoggerMock.mockReset();
    generateRequestIdMock.mockClear();
    createTraceparentMock.mockClear();
    loggerMocks.info.mockReset();
    loggerMocks.warn.mockReset();
    loggerMocks.error.mockReset();

    cookiesMock.mockResolvedValue({
      getAll: () => [],
      set: vi.fn(),
    });
    createServerLoggerMock.mockReturnValue(loggerMocks);
    withServerSpanMock.mockImplementation(async (_name: string, run: () => Promise<unknown>) =>
      run(),
    );
    getActiveTraceContextMock.mockReturnValue({
      trace_id: "a".repeat(32),
      span_id: "b".repeat(16),
    });

    baseFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", baseFetch);

    createServerClientMock.mockImplementation((_url, _key, options) => {
      instrumentedFetch = options.global.fetch;
      return { auth: { getUser: vi.fn() } };
    });

    const { createServerSupabaseClient } = await import("./supabase-server");
    await createServerSupabaseClient();
  });

  it("passes through non-RPC URLs without wrapping", async () => {
    await instrumentedFetch("https://example.test/rest/v1/conditions");
    expect(withServerSpanMock).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledWith("https://example.test/rest/v1/conditions", undefined);
  });

  it("resolves the RPC name from string, URL, and Request inputs", async () => {
    await instrumentedFetch("https://example.test/rest/v1/rpc/money_list");
    expect(withServerSpanMock).toHaveBeenCalledWith(
      "api.supabase.rpc.money_list",
      expect.any(Function),
    );

    withServerSpanMock.mockClear();
    await instrumentedFetch(new URL("https://example.test/rest/v1/rpc/health_ingest?x=1"));
    expect(withServerSpanMock).toHaveBeenCalledWith(
      "api.supabase.rpc.health_ingest",
      expect.any(Function),
    );

    withServerSpanMock.mockClear();
    await instrumentedFetch(
      new Request("https://example.test/rest/v1/rpc/apply_rule", { method: "POST" }),
    );
    expect(withServerSpanMock).toHaveBeenCalledWith(
      "api.supabase.rpc.apply_rule",
      expect.any(Function),
    );
  });

  it("injects traceparent and x-request-id when they are missing", async () => {
    await instrumentedFetch("https://example.test/rest/v1/rpc/money_list", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    expect(createTraceparentMock).toHaveBeenCalledWith("a".repeat(32), "b".repeat(16));
    expect(generateRequestIdMock).toHaveBeenCalled();
    const init = baseFetch.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("traceparent")).toBe(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`);
    expect(headers.get("x-request-id")).toBe("generated-req-id");
  });

  it("logs completed, failed, and thrown RPC outcomes", async () => {
    await instrumentedFetch("https://example.test/rest/v1/rpc/ok_rpc");
    expect(loggerMocks.info).toHaveBeenCalledWith(
      "server_supabase_rpc_completed",
      expect.objectContaining({ rpc_name: "ok_rpc", ok: true, status_code: 200 }),
    );

    loggerMocks.info.mockClear();
    baseFetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await instrumentedFetch("https://example.test/rest/v1/rpc/fail_rpc");
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      "server_supabase_rpc_failed",
      expect.objectContaining({ rpc_name: "fail_rpc", ok: false, status_code: 500 }),
    );

    baseFetch.mockRejectedValueOnce(new Error("network down"));
    await expect(instrumentedFetch("https://example.test/rest/v1/rpc/boom_rpc")).rejects.toThrow(
      "network down",
    );
    expect(loggerMocks.error).toHaveBeenCalledWith(
      "server_supabase_rpc_exception",
      expect.objectContaining({
        attrs: { rpc_name: "boom_rpc" },
        error: expect.objectContaining({
          name: "SupabaseServerRpcFetchError",
          message: "network down",
        }),
      }),
    );
  });
});
