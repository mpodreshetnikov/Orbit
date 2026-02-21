import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("POST /api/notifications/mark-shown", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
  });

  function mockAuthenticatedSupabase(options?: { updateError?: string }) {
    const eq = vi.fn().mockResolvedValue({
      error: options?.updateError ? { message: options.updateError } : null,
    });
    const inFilter = vi.fn().mockReturnValue({ eq });
    const update = vi.fn().mockReturnValue({ in: inFilter });
    const from = vi.fn().mockReturnValue({ update });

    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    });

    return { from, update, inFilter, eq };
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
      new Request("http://localhost/api/notifications/mark-shown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "digest-id" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for invalid JSON", async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/mark-shown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
  });

  it("returns 400 when id and ids are missing", async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/mark-shown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing id or ids" });
  });

  it("returns 500 when update fails", async () => {
    mockAuthenticatedSupabase({ updateError: "update failed" });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/mark-shown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "digest-1" }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "update failed" });
  });

  it("marks filtered ids as shown and returns 204", async () => {
    const { from, update, inFilter, eq } = mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/mark-shown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["digest-1", "", "digest-2"] }),
      }),
    );

    expect(response.status).toBe(204);
    expect(from).toHaveBeenCalledWith("notification_digests");
    expect(update).toHaveBeenCalledWith({ sent_at: expect.any(String) });
    expect(inFilter).toHaveBeenCalledWith("id", ["digest-1", "digest-2"]);
    expect(eq).toHaveBeenCalledWith("auth_user_id", "user-1");
  });
});
