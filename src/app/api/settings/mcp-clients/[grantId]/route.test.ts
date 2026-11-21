import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock, revokeGrantOwnedByUserMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  revokeGrantOwnedByUserMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

vi.mock("@/lib/mcp/oauth-store", () => ({
  revokeGrantOwnedByUser: revokeGrantOwnedByUserMock,
}));

import { DELETE } from "./route";

function callDelete(grantId: string) {
  return DELETE(new Request("https://app.test/api/settings/mcp-clients/" + grantId), {
    params: Promise.resolve({ grantId }),
  });
}

describe("DELETE /api/settings/mcp-clients/[grantId]", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
    revokeGrantOwnedByUserMock.mockReset();
  });

  it("returns 401 when the session is missing", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const response = await callDelete("grant-1");
    expect(response.status).toBe(401);
    expect(revokeGrantOwnedByUserMock).not.toHaveBeenCalled();
  });

  it("revokes an owned grant and returns 204", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    revokeGrantOwnedByUserMock.mockResolvedValue(true);

    const response = await callDelete("grant-1");
    expect(response.status).toBe(204);
    expect(revokeGrantOwnedByUserMock).toHaveBeenCalledWith("grant-1", "user-1");
  });

  it("returns 404 when the grant is missing or not owned", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    revokeGrantOwnedByUserMock.mockResolvedValue(false);

    const response = await callDelete("grant-other");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("returns 500 when revocation fails", async () => {
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    revokeGrantOwnedByUserMock.mockRejectedValue(new Error("db down"));

    const response = await callDelete("grant-1");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db down" });
  });
});
