import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock, listGrantsForUserMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  listGrantsForUserMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

vi.mock("@/lib/mcp/oauth-store", () => ({
  listGrantsForUser: listGrantsForUserMock,
}));

import { GET } from "./route";

describe("GET /api/settings/mcp-clients", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
    listGrantsForUserMock.mockReset();
  });

  it("returns 401 when the session is missing", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const response = await GET();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(listGrantsForUserMock).not.toHaveBeenCalled();
  });

  it("lists the caller's connected clients without token material", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    listGrantsForUserMock.mockResolvedValue([
      {
        id: "grant-1",
        client_id: "client-1",
        client_name: "Claude",
        auth_user_id: "user-1",
        user_email: "u@example.com",
        scope: "openid",
        access_token_hash: "secret-hash",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_token_hash: "refresh-hash",
        refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
        revoked_at: null,
        last_used_at: "2026-11-20T12:00:00.000Z",
        created_at: "2026-11-19T12:00:00.000Z",
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(listGrantsForUserMock).toHaveBeenCalledWith("user-1");
    await expect(response.json()).resolves.toEqual({
      clients: [
        {
          grantId: "grant-1",
          clientId: "client-1",
          clientName: "Claude",
          scope: "openid",
          createdAt: "2026-11-19T12:00:00.000Z",
          lastUsedAt: "2026-11-20T12:00:00.000Z",
        },
      ],
    });
  });

  it("returns 500 when listing fails", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    listGrantsForUserMock.mockRejectedValue(new Error("db down"));

    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db down" });
  });
});
