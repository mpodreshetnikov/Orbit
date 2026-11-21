import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMcpBearerToken } from "./verify-token";
import type { GrantRow } from "./oauth-store";

const {
  findGrantByAccessTokenMock,
  isGrantUserAllowedMock,
  touchGrantMock,
  logMcpAuthAcceptedMock,
  logMcpAuthRejectedMock,
} = vi.hoisted(() => ({
  findGrantByAccessTokenMock: vi.fn(),
  isGrantUserAllowedMock: vi.fn(),
  touchGrantMock: vi.fn().mockResolvedValue(undefined),
  logMcpAuthAcceptedMock: vi.fn(),
  logMcpAuthRejectedMock: vi.fn(),
}));

vi.mock("./oauth-store", () => ({
  findGrantByAccessToken: findGrantByAccessTokenMock,
  isGrantUserAllowed: isGrantUserAllowedMock,
  touchGrant: touchGrantMock,
}));

vi.mock("./audit", async () => {
  const actual = await vi.importActual<typeof import("./audit")>("./audit");
  return {
    ...actual,
    logMcpAuthAccepted: logMcpAuthAcceptedMock,
    logMcpAuthRejected: logMcpAuthRejectedMock,
  };
});

vi.mock("./config", () => ({
  getPublicOrigin: () => "http://localhost:3000",
  getResourceIdentifier: () => "http://localhost:3000/api/mcp",
}));

function grant(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "grant-1",
    client_id: "mcp_client_1",
    auth_user_id: "11111111-1111-1111-1111-111111111111",
    user_email: "u@example.com",
    scope: "health:read health:write",
    access_token_hash: "hash",
    access_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    refresh_token_hash: null,
    refresh_token_expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("verifyMcpBearerToken audit", () => {
  const request = new Request("http://localhost:3000/api/mcp");

  beforeEach(() => {
    findGrantByAccessTokenMock.mockReset();
    isGrantUserAllowedMock.mockReset();
    touchGrantMock.mockClear();
    logMcpAuthAcceptedMock.mockClear();
    logMcpAuthRejectedMock.mockClear();
  });

  it("rejects a missing bearer and logs missing_token", async () => {
    await expect(verifyMcpBearerToken(request)).resolves.toBeUndefined();
    expect(logMcpAuthRejectedMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "missing_token" }),
    );
    expect(logMcpAuthAcceptedMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown token and logs a hash prefix only", async () => {
    findGrantByAccessTokenMock.mockResolvedValue(null);

    await expect(verifyMcpBearerToken(request, "secret-token")).resolves.toBeUndefined();

    expect(logMcpAuthRejectedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "unknown",
        tokenHashPrefix: expect.stringMatching(/^[a-f0-9]{8}$/),
      }),
    );
    const attrs = logMcpAuthRejectedMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(attrs)).not.toContain("secret-token");
  });

  it("rejects a revoked grant", async () => {
    findGrantByAccessTokenMock.mockResolvedValue(grant({ revoked_at: new Date().toISOString() }));

    await expect(verifyMcpBearerToken(request, "tok")).resolves.toBeUndefined();

    expect(logMcpAuthRejectedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "revoked",
        grantId: "grant-1",
        clientId: "mcp_client_1",
      }),
    );
  });

  it("rejects an expired grant", async () => {
    findGrantByAccessTokenMock.mockResolvedValue(
      grant({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
    );

    await expect(verifyMcpBearerToken(request, "tok")).resolves.toBeUndefined();

    expect(logMcpAuthRejectedMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "expired", grantId: "grant-1" }),
    );
  });

  it("rejects a de-allowlisted user", async () => {
    findGrantByAccessTokenMock.mockResolvedValue(grant());
    isGrantUserAllowedMock.mockResolvedValue(false);

    await expect(verifyMcpBearerToken(request, "tok")).resolves.toBeUndefined();

    expect(logMcpAuthRejectedMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "not_allowlisted", grantId: "grant-1" }),
    );
  });

  it("accepts a usable allowlisted grant and touches last_used_at", async () => {
    findGrantByAccessTokenMock.mockResolvedValue(grant());
    isGrantUserAllowedMock.mockResolvedValue(true);

    const auth = await verifyMcpBearerToken(request, "tok");

    expect(auth?.clientId).toBe("mcp_client_1");
    expect(auth?.extra.grantId).toBe("grant-1");
    expect(touchGrantMock).toHaveBeenCalledWith("grant-1");
    expect(logMcpAuthAcceptedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        grantId: "grant-1",
        clientId: "mcp_client_1",
        userIdHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      }),
    );
    expect(logMcpAuthRejectedMock).not.toHaveBeenCalled();
  });
});
