import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("POST /api/medications/regenerate-events", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
  });

  function mockAuthenticatedSupabase(options?: {
    prefsTimezone?: string | null;
    personFound?: boolean;
    clearAllResult?: number;
    clearPersonResult?: number;
    generateAllResult?: number;
    generatePersonResult?: number;
    generateError?: string;
  }) {
    const prefsMaybeSingle = vi.fn().mockResolvedValue({
      data: options?.prefsTimezone
        ? { checkup_notification_timezone: options.prefsTimezone }
        : null,
      error: null,
    });
    const prefsEq = vi.fn().mockReturnValue({ maybeSingle: prefsMaybeSingle });
    const prefsSelect = vi.fn().mockReturnValue({ eq: prefsEq });
    const prefsUpsert = vi.fn().mockResolvedValue({ error: null });

    const personMaybeSingle = vi.fn().mockResolvedValue({
      data: options?.personFound === false ? null : { id: "person-1" },
      error: null,
    });
    const personEq = vi.fn().mockReturnValue({ maybeSingle: personMaybeSingle });
    const personSelect = vi.fn().mockReturnValue({ eq: personEq });

    const from = vi.fn((table: string) => {
      if (table === "user_preferences") {
        return {
          select: prefsSelect,
          upsert: prefsUpsert,
        };
      }
      if (table === "persons") {
        return {
          select: personSelect,
        };
      }
      return {};
    });

    const rpc = vi.fn().mockImplementation((fnName: string) => {
      if (fnName === "clear_future_med_dose_events") {
        return Promise.resolve({
          data: options?.clearAllResult ?? 3,
          error: null,
        });
      }
      if (fnName === "generate_med_dose_events_for_horizon") {
        if (options?.generateError) {
          return Promise.resolve({
            data: null,
            error: { message: options.generateError },
          });
        }
        return Promise.resolve({
          data: options?.generateAllResult ?? 8,
          error: null,
        });
      }
      if (fnName === "clear_future_med_dose_events_for_person") {
        return Promise.resolve({
          data: options?.clearPersonResult ?? 2,
          error: null,
        });
      }
      if (fnName === "generate_med_dose_events_for_horizon_for_person") {
        if (options?.generateError) {
          return Promise.resolve({
            data: null,
            error: { message: options.generateError },
          });
        }
        return Promise.resolve({
          data: options?.generatePersonResult ?? 5,
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
      from,
      rpc,
    });

    return { from, rpc, prefsUpsert };
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
    const response = await POST(
      new Request("http://localhost/api/medications/regenerate-events", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("regenerates all linked persons using stored timezone by default", async () => {
    const { rpc } = mockAuthenticatedSupabase({ prefsTimezone: "Europe/Berlin" });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/medications/regenerate-events", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      eventsCleared: 3,
      eventsGenerated: 8,
      timezone: "Europe/Berlin",
    });
    expect(rpc).toHaveBeenCalledWith("clear_future_med_dose_events", {
      p_auth_user_id: "user-1",
      p_horizon_days: 7,
    });
    expect(rpc).toHaveBeenCalledWith("generate_med_dose_events_for_horizon", {
      p_auth_user_id: "user-1",
      p_timezone: "Europe/Berlin",
      p_horizon_days: 7,
    });
  });

  it("persists client timezone override and regenerates one person", async () => {
    const { prefsUpsert, rpc } = mockAuthenticatedSupabase({
      prefsTimezone: "UTC",
      personFound: true,
      clearPersonResult: 4,
      generatePersonResult: 9,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/medications/regenerate-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: "Asia/Tokyo",
          person_id: "person-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      eventsCleared: 4,
      eventsGenerated: 9,
      timezone: "Asia/Tokyo",
      person_id: "person-1",
    });
    expect(prefsUpsert).toHaveBeenCalledWith(
      { auth_user_id: "user-1", checkup_notification_timezone: "Asia/Tokyo" },
      { onConflict: "auth_user_id" },
    );
    expect(rpc).toHaveBeenCalledWith("clear_future_med_dose_events_for_person", {
      p_person_id: "person-1",
      p_horizon_days: 7,
    });
    expect(rpc).toHaveBeenCalledWith("generate_med_dose_events_for_horizon_for_person", {
      p_person_id: "person-1",
      p_timezone: "Asia/Tokyo",
      p_horizon_days: 7,
    });
  });

  it("returns 404 when person is missing or inaccessible", async () => {
    mockAuthenticatedSupabase({ personFound: false });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/medications/regenerate-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: "missing-person" }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Person not found or access denied",
    });
  });

  it("returns 500 when generator RPC fails", async () => {
    mockAuthenticatedSupabase({ generateError: "generator failed" });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/medications/regenerate-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: "person-1" }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Event generator failed",
      details: "generator failed",
    });
  });

  it("returns outer failure when supabase client creation fails", async () => {
    createServerSupabaseClientMock.mockRejectedValue(new Error("client init failed"));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/medications/regenerate-events", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Regenerate events failed",
      details: "client init failed",
    });
  });
});
