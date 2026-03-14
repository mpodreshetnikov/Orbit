import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, fetchEdgeFunctionWithTelemetryMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fetchEdgeFunctionWithTelemetryMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/observability/edge-function-fetch", () => ({
  fetchEdgeFunctionWithTelemetry: fetchEdgeFunctionWithTelemetryMock,
}));

describe("money-categorize-client", () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    createClientMock.mockReset();
    fetchEdgeFunctionWithTelemetryMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  });

  it("calls the edge function with auth + telemetry attrs", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-1" } },
        }),
      },
    });
    fetchEdgeFunctionWithTelemetryMock.mockResolvedValue(
      new Response(JSON.stringify({ runs: [], count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { callMoneyCategorizeAction } = await import("./money-categorize-client");
    const payload = await callMoneyCategorizeAction<{ runs: unknown[]; count: number }>({
      action: "apply_pipeline",
      line_item_ids: ["line-1"],
    });

    expect(payload).toEqual({ runs: [], count: 0 });
    expect(fetchEdgeFunctionWithTelemetryMock).toHaveBeenCalledWith(
      "https://project.supabase.co/functions/v1/money-categorize",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          action: "apply_pipeline",
          line_item_ids: ["line-1"],
        }),
      }),
      expect.objectContaining({
        component: "money-category-rules",
        operation: "money-categorize-action",
        attrs: { action: "apply_pipeline" },
      }),
    );
  });

  it("fails when the user is not authenticated", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
        }),
      },
    });

    const { callMoneyCategorizeAction } = await import("./money-categorize-client");
    await expect(callMoneyCategorizeAction({ action: "preview_pipeline" })).rejects.toThrow(
      "Not authenticated",
    );
    expect(fetchEdgeFunctionWithTelemetryMock).not.toHaveBeenCalled();
  });

  it("uses server errors and falls back when error payload is not json", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-2" } },
        }),
      },
    });
    fetchEdgeFunctionWithTelemetryMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "categorize failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("bad gateway", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
      );

    const { callMoneyCategorizeAction } = await import("./money-categorize-client");

    await expect(
      callMoneyCategorizeAction({
        action: "replay_transaction",
        transaction_id: "tx-1",
      }),
    ).rejects.toThrow("categorize failed");

    await expect(
      callMoneyCategorizeAction({
        action: 42,
      }),
    ).rejects.toThrow("Money categorize request failed");

    expect(fetchEdgeFunctionWithTelemetryMock).toHaveBeenLastCalledWith(
      "https://project.supabase.co/functions/v1/money-categorize",
      expect.any(Object),
      expect.objectContaining({
        attrs: { action: "unknown" },
      }),
    );
  });

  it("turns aborted requests into a timeout error", async () => {
    const immediateSetTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(immediateSetTimeout);
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-3" } },
        }),
      },
    });
    fetchEdgeFunctionWithTelemetryMock.mockImplementation(
      async (_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new Error("request aborted");
        }
        throw new Error("request unexpectedly not aborted");
      },
    );

    const { callMoneyCategorizeAction } = await import("./money-categorize-client");

    await expect(
      callMoneyCategorizeAction({
        action: "preview_pipeline",
        line_item_id: "line-1",
      }),
    ).rejects.toThrow("Money categorize request timed out");

    setTimeoutSpy.mockRestore();
  });

  afterEach(() => {
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
  });
});
