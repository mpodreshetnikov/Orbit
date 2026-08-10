import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const store = vi.hoisted(() => ({
  claimGrantForRotation: vi.fn(),
  consumeAuthorizationCode: vi.fn(),
  findGrantByRefreshToken: vi.fn(),
  getClient: vi.fn(),
  issueGrant: vi.fn(),
  linkCodeToGrant: vi.fn(),
  revokeGrantChain: vi.fn(),
}));

vi.mock("@/lib/mcp/oauth-store", () => store);

const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const codeRow = {
  id: "code-row-1",
  client_id: "mcp_abc",
  auth_user_id: "user-1",
  user_email: "u@example.com",
  redirect_uri: REDIRECT_URI,
  scope: "health:read health:write",
  code_challenge: CHALLENGE,
};

async function post(body: Record<string, string>) {
  const { POST } = await import("./route");
  const response = await POST(
    new Request("https://app.test/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }),
  );
  return { response, body: await response.json().catch(() => null) };
}

function codeGrantBody(overrides: Record<string, string> = {}) {
  return {
    grant_type: "authorization_code",
    code: "the-code",
    client_id: "mcp_abc",
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
    ...overrides,
  };
}

describe("POST /api/oauth/token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    for (const fn of Object.values(store)) fn.mockReset();

    store.consumeAuthorizationCode.mockResolvedValue({ status: "ok", row: codeRow });
    store.getClient.mockResolvedValue({ client_id: "mcp_abc", redirect_uris: [REDIRECT_URI] });
    store.issueGrant.mockResolvedValue({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresInSeconds: 2_592_000,
      scope: "health:read health:write",
      grantId: "grant-1",
    });
    store.claimGrantForRotation.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exchanges a valid code for a token pair", async () => {
    const { response, body } = await post(codeGrantBody());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      access_token: "access-1",
      refresh_token: "refresh-1",
      token_type: "Bearer",
      scope: "health:read health:write",
    });
    // The grant must act as the user the code was minted for.
    expect(store.issueGrant).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: "user-1", userEmail: "u@example.com" }),
    );
    // Recorded so a replay of this code knows what to revoke.
    expect(store.linkCodeToGrant).toHaveBeenCalledWith("code-row-1", "grant-1");
  });

  it("never caches a token response", async () => {
    const { response } = await post(codeGrantBody());
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a replayed code and revokes what it originally issued", async () => {
    store.consumeAuthorizationCode.mockResolvedValue({
      status: "replayed",
      issuedGrantId: "grant-1",
    });

    const { response, body } = await post(codeGrantBody());

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_grant");
    expect(store.revokeGrantChain).toHaveBeenCalledWith("grant-1");
    expect(store.issueGrant).not.toHaveBeenCalled();
  });

  it("rejects an unknown or expired code", async () => {
    store.consumeAuthorizationCode.mockResolvedValue({ status: "not_found" });

    const { response, body } = await post(codeGrantBody());

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_grant");
    expect(store.issueGrant).not.toHaveBeenCalled();
  });

  it("rejects a wrong PKCE verifier", async () => {
    const { response, body } = await post(codeGrantBody({ code_verifier: "b".repeat(64) }));

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_grant");
    expect(store.issueGrant).not.toHaveBeenCalled();
  });

  it("rejects a redirect_uri that differs from the authorization request", async () => {
    const { body } = await post(codeGrantBody({ redirect_uri: "https://evil.example/cb" }));

    expect(body.error).toBe("invalid_grant");
    expect(store.issueGrant).not.toHaveBeenCalled();
  });

  it("rejects a code redeemed by a different client", async () => {
    const { body } = await post(codeGrantBody({ client_id: "mcp_other" }));

    expect(body.error).toBe("invalid_grant");
    expect(store.issueGrant).not.toHaveBeenCalled();
  });

  it.each([
    ["code", "code"],
    ["client_id", "client_id"],
    ["redirect_uri", "redirect_uri"],
    ["code_verifier", "code_verifier"],
  ])("rejects a request missing %s", async (_label, field) => {
    const params = codeGrantBody();
    delete (params as Record<string, string>)[field];

    const { body } = await post(params);
    expect(body.error).toBe("invalid_request");
  });

  it("rejects an unsupported grant type", async () => {
    const { body } = await post({ grant_type: "password" });
    expect(body.error).toBe("unsupported_grant_type");
  });

  it("404s when the MCP server is disabled", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "");
    const { response } = await post(codeGrantBody());
    expect(response.status).toBe(404);
  });

  describe("refresh_token grant", () => {
    const grant = {
      id: "grant-1",
      client_id: "mcp_abc",
      auth_user_id: "user-1",
      user_email: "u@example.com",
      scope: "health:read health:write",
      revoked_at: null,
      refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };

    it("claims the old grant before issuing its replacement", async () => {
      store.findGrantByRefreshToken.mockResolvedValue(grant);
      store.claimGrantForRotation.mockResolvedValue(grant);
      store.issueGrant.mockResolvedValue({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresInSeconds: 2_592_000,
        scope: "health:read health:write",
        grantId: "grant-2",
      });

      const { response, body } = await post({
        grant_type: "refresh_token",
        refresh_token: "refresh-1",
      });

      expect(response.status).toBe(200);
      expect(body.access_token).toBe("access-2");
      expect(store.claimGrantForRotation).toHaveBeenCalledWith("grant-1");
      expect(store.issueGrant).toHaveBeenCalledWith(
        expect.objectContaining({ rotatedFrom: "grant-1" }),
      );
      // Claiming must precede issuing, or two concurrent refreshes could both
      // mint a replacement and leave two live token families.
      expect(store.claimGrantForRotation.mock.invocationCallOrder[0]).toBeLessThan(
        store.issueGrant.mock.invocationCallOrder[0],
      );
      // A chain revoke here would kill the token just minted, since it records
      // rotated_from = grant-1.
      expect(store.revokeGrantChain).not.toHaveBeenCalled();
    });

    it("treats losing the claim race as reuse and issues nothing", async () => {
      store.findGrantByRefreshToken.mockResolvedValue(grant);
      // Another concurrent refresh already claimed this grant.
      store.claimGrantForRotation.mockResolvedValue(null);

      const { body } = await post({ grant_type: "refresh_token", refresh_token: "refresh-1" });

      expect(body.error).toBe("invalid_grant");
      expect(store.issueGrant).not.toHaveBeenCalled();
      expect(store.revokeGrantChain).toHaveBeenCalledWith("grant-1");
    });

    it("treats reuse of a revoked refresh token as compromise and kills the chain", async () => {
      store.findGrantByRefreshToken.mockResolvedValue({
        ...grant,
        revoked_at: new Date().toISOString(),
      });

      const { body } = await post({ grant_type: "refresh_token", refresh_token: "refresh-1" });

      expect(body.error).toBe("invalid_grant");
      expect(store.revokeGrantChain).toHaveBeenCalledWith("grant-1");
      expect(store.issueGrant).not.toHaveBeenCalled();
    });

    it("rejects an expired refresh token", async () => {
      store.findGrantByRefreshToken.mockResolvedValue({
        ...grant,
        refresh_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      });

      const { body } = await post({ grant_type: "refresh_token", refresh_token: "refresh-1" });
      expect(body.error).toBe("invalid_grant");
      expect(store.issueGrant).not.toHaveBeenCalled();
    });

    it("rejects an unknown refresh token", async () => {
      store.findGrantByRefreshToken.mockResolvedValue(null);

      const { body } = await post({ grant_type: "refresh_token", refresh_token: "nope" });
      expect(body.error).toBe("invalid_grant");
    });

    it("rejects a refresh token presented by a different client", async () => {
      store.findGrantByRefreshToken.mockResolvedValue(grant);

      const { body } = await post({
        grant_type: "refresh_token",
        refresh_token: "refresh-1",
        client_id: "mcp_other",
      });

      expect(body.error).toBe("invalid_grant");
      expect(store.issueGrant).not.toHaveBeenCalled();
    });
  });
});
