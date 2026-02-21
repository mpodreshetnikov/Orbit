import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("POST /api/push-subscribe", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
  });

  function mockAuthenticatedSupabase(options?: { upsertError?: string }) {
    const upsert = vi.fn().mockResolvedValue({
      error: options?.upsertError ? { message: options.upsertError } : null,
    });
    const from = vi.fn().mockReturnValue({ upsert });

    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    });

    return { upsert, from };
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
      new Request("http://localhost/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example/sub",
          keys: { p256dh: "p256", auth: "auth" },
        }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when JSON is invalid", async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
  });

  it("returns 400 when endpoint or keys are missing", async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example/sub",
          keys: { p256dh: "", auth: "auth" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing endpoint or keys" });
  });

  it("returns 500 when subscription upsert fails", async () => {
    mockAuthenticatedSupabase({ upsertError: "db failed" });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example/sub",
          keys: { p256dh: "p256", auth: "auth" },
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db failed" });
  });

  it("upserts subscription and returns 204", async () => {
    const { upsert, from } = mockAuthenticatedSupabase();

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example/sub",
          keys: { p256dh: "p256", auth: "auth" },
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(upsert).toHaveBeenCalledWith(
      {
        auth_user_id: "user-1",
        endpoint: "https://push.example/sub",
        p256dh: "p256",
        auth: "auth",
      },
      { onConflict: "endpoint" },
    );
  });
});
