import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("POST /api/notifications/medication-action", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
  });

  function mockAuthenticatedSupabase() {
    const rpc = vi.fn().mockResolvedValue({ error: null });
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
    const response = await POST(
      new Request("http://localhost/api/notifications/medication-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "taken", dose_event_ids: ["dose-id"] }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for invalid JSON", async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/medication-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
  });

  it("returns 400 when dose_event_ids is missing", async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/medication-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "taken" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing or empty dose_event_ids" });
  });

  it("returns 400 when action is invalid", async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/medication-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "snoozed", dose_event_ids: ["dose-1"] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "action must be 'taken' or 'skipped'",
    });
  });

  it("calls mark_dose_taken for valid ids and returns 204", async () => {
    const { rpc } = mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/medication-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "taken",
          dose_event_ids: ["dose-1", "", null, "dose-2"],
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "mark_dose_taken",
      expect.objectContaining({
        p_dose_event_id: "dose-1",
        p_taken_at: expect.any(String),
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "mark_dose_taken",
      expect.objectContaining({
        p_dose_event_id: "dose-2",
        p_taken_at: expect.any(String),
      }),
    );
  });

  it("uses mark_dose_skipped when action is skipped", async () => {
    const { rpc } = mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/medication-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "skipped",
          dose_event_ids: ["dose-1"],
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("mark_dose_skipped", { p_dose_event_id: "dose-1" });
  });
});
