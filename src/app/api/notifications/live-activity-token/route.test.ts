import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock, createClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

// Low-entropy hex on purpose — realistic random tokens trip gitleaks generic-api-key.
const VALID_TOKEN = "aa".repeat(16);

describe("POST /api/notifications/live-activity-token", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
    createClientMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
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

    const neq = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockReturnValue({ neq });
    const del = vi.fn().mockReturnValue({ eq });
    createClientMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ delete: del }),
    });

    return { upsert, from, deleteEq: eq, deleteNeq: neq };
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
          pushToStartToken: VALID_TOKEN,
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

  it("returns 400 when token is not a string", async () => {
    mockAuthenticatedSupabase();
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: { nested: true },
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "sandbox",
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when token is not hex or too short", async () => {
    mockAuthenticatedSupabase();
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: "not-hex!!",
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "sandbox",
        }),
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
          pushToStartToken: VALID_TOKEN,
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "staging",
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("reclaims the token from other users then upserts and returns 204", async () => {
    const { upsert, from, deleteEq, deleteNeq } = mockAuthenticatedSupabase();
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: VALID_TOKEN,
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "sandbox",
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(createClientMock).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("push_to_start_token", VALID_TOKEN);
    expect(deleteNeq).toHaveBeenCalledWith("auth_user_id", "user-1");
    expect(from).toHaveBeenCalledWith("live_activity_tokens");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_user_id: "user-1",
        push_to_start_token: VALID_TOKEN,
        bundle_id: "com.podreshetnikov.orbit",
        apns_environment: "sandbox",
      }),
      { onConflict: "auth_user_id,push_to_start_token" },
    );
  });

  it("returns 500 without leaking DB error.message", async () => {
    mockAuthenticatedSupabase({ upsertError: "db down with secrets" });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/notifications/live-activity-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushToStartToken: VALID_TOKEN,
          bundleId: "com.podreshetnikov.orbit",
          apnsEnvironment: "production",
        }),
      }),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to register token" });
  });
});
