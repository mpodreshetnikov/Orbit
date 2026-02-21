import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("POST /api/medications/run-cron", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  function mockAuthenticatedSupabase(options?: {
    genRows?: Array<{ events_generated?: number; refill_digests_created?: number }>;
    genError?: string;
  }) {
    const rpc = vi.fn().mockImplementation((fnName: string) => {
      if (fnName === "run_med_event_generation_for_all_users") {
        if (options?.genError) {
          return Promise.resolve({
            data: null,
            error: { message: options.genError },
          });
        }
        return Promise.resolve({
          data: options?.genRows ?? [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      rpc,
    });

    return { rpc };
  }

  it("returns 401 when user is unauthenticated", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("unauthorized"),
        }),
      },
    });

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 500 when Supabase env variables are missing", async () => {
    mockAuthenticatedSupabase();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Server configuration error: missing Supabase URL or service role key",
    });
  });

  it("returns 500 when event generation RPC fails", async () => {
    mockAuthenticatedSupabase({ genError: "rpc failed" });

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Event generator failed",
      details: "rpc failed",
    });
  });

  it("handles non-JSON error responses from notifications-cron", async () => {
    mockAuthenticatedSupabase({
      genRows: [{ events_generated: 3, refill_digests_created: 1 }],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream unavailable", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Cron function failed",
      details: {},
      eventsGenerated: 3,
      refillDigestsCreated: 1,
    });
  });

  it("handles JSON error responses from notifications-cron", async () => {
    mockAuthenticatedSupabase({
      genRows: [{ events_generated: 2, refill_digests_created: 4 }],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "cron failed", reason: "timeout" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "cron failed",
      details: { error: "cron failed", reason: "timeout" },
      eventsGenerated: 2,
      refillDigestsCreated: 4,
    });
  });

  it("returns 500 when cron invocation throws", async () => {
    mockAuthenticatedSupabase({
      genRows: [{ events_generated: 5, refill_digests_created: 6 }],
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to invoke notifications-cron",
      details: "network down",
      eventsGenerated: 5,
      refillDigestsCreated: 6,
    });
  });

  it("returns aggregated counters when run succeeds", async () => {
    const { rpc } = mockAuthenticatedSupabase({
      genRows: [
        { events_generated: 1, refill_digests_created: 2 },
        { events_generated: 3, refill_digests_created: 4 },
      ],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sent: 7 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { POST } = await import("./route");
    const response = await POST();

    expect(rpc).toHaveBeenCalledWith("run_med_event_generation_for_all_users", {
      p_horizon_days: 7,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      usersProcessed: 2,
      eventsGenerated: 4,
      refillDigestsCreated: 6,
      cron: { sent: 7 },
    });
  });

  it("returns outer failure when client creation throws", async () => {
    createServerSupabaseClientMock.mockRejectedValue(new Error("client init failed"));

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Medication cron failed",
      details: "client init failed",
      eventsGenerated: 0,
      refillDigestsCreated: 0,
    });
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    }
  });
});
