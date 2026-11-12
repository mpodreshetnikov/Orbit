import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("POST /api/notifications/live-activity-token", () => {
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
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: "tok",
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "sandbox",
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when JSON is invalid", async () => {
    mockAuthenticatedSupabase();
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when fields are missing or environment is invalid", async () => {
    mockAuthenticatedSupabase();
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: "tok",
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "staging",
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("upserts the token and returns 204", async () => {
    const { upsert, from } = mockAuthenticatedSupabase();
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: "aabbcc",
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "sandbox",
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(from).toHaveBeenCalledWith("live_activity_tokens");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_user_id: "user-1",
        push_to_start_token: "aabbcc",
        bundle_id: "com.podreshetnikov.orbit",
        apns_environment: "sandbox",
      }),
      { onConflict: "auth_user_id,push_to_start_token" },
    );
  });

  it("returns 500 when upsert fails", async () => {
    mockAuthenticatedSupabase({ upsertError: "db down" });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: "aabbcc",
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "production",
        }),
      }),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db down" });
  });
});
