import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  createAuthorizationCode: vi.fn(),
  getClient: vi.fn(),
}));

const cryptoMocks = vi.hoisted(() => ({
  verifyConsentToken: vi.fn(),
}));

const supabaseMocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/mcp/oauth-store", () => store);
vi.mock("@/lib/mcp/crypto", () => cryptoMocks);
vi.mock("@/lib/supabase-server", () => supabaseMocks);

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

function formBody(overrides: Record<string, string | null> = {}) {
  const fields: Record<string, string> = {
    client_id: "mcp_abc",
    redirect_uri: REDIRECT_URI,
    scope: "health:read health:write",
    code_challenge: "challenge",
    consent_token: "token",
    state: "state-1",
    resource: "https://app.test/mcp",
    decision: "approve",
    ...Object.fromEntries(
      Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== null),
    ),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete fields[key];
  }
  return fields;
}

async function post(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const { POST } = await import("./route");
  return POST(
    new Request("https://app.test/api/oauth/authorize/decision", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
  );
}

describe("POST /api/oauth/authorize/decision", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    vi.stubEnv("MCP_OAUTH_SIGNING_SECRET", "test-signing-secret");
    for (const fn of Object.values(store)) fn.mockReset();
    cryptoMocks.verifyConsentToken.mockReset();
    supabaseMocks.createServerSupabaseClient.mockReset();

    store.getClient.mockResolvedValue({
      client_id: "mcp_abc",
      redirect_uris: [REDIRECT_URI],
    });
    cryptoMocks.verifyConsentToken.mockReturnValue(true);
    store.createAuthorizationCode.mockResolvedValue("auth-code-1");
    supabaseMocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "u@example.com" } },
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("404s when the MCP server is disabled", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "");
    const response = await post(formBody());
    expect(response.status).toBe(404);
    expect(store.getClient).not.toHaveBeenCalled();
  });

  it("rejects a submission missing required form fields", async () => {
    const response = await post(formBody({ client_id: null }));
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toMatch(/Malformed consent submission/);
    expect(store.getClient).not.toHaveBeenCalled();
  });

  it("rejects an unknown client", async () => {
    store.getClient.mockResolvedValue(null);
    const response = await post(formBody());
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toMatch(/no longer valid/);
    expect(cryptoMocks.verifyConsentToken).not.toHaveBeenCalled();
  });

  it("rejects a redirect_uri that is not registered for the client", async () => {
    store.getClient.mockResolvedValue({
      client_id: "mcp_abc",
      redirect_uris: ["https://other.example/cb"],
    });
    const response = await post(formBody());
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toMatch(/no longer valid/);
  });

  it("rejects a bad or expired consent token", async () => {
    cryptoMocks.verifyConsentToken.mockReturnValue(false);
    const response = await post(formBody());
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toMatch(/expired or was modified/);
    expect(store.createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("redirects with access_denied when the user denies consent", async () => {
    const response = await post(formBody({ decision: "deny" }));
    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toContain("error=access_denied");
    expect(location).toContain("state=state-1");
    expect(store.createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("401s when there is no signed-in user email", async () => {
    supabaseMocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    const response = await post(formBody());
    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toMatch(/not signed in/);
    expect(store.createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("mints an authorization code and redirects on approval", async () => {
    const response = await post(formBody());

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toContain("code=auth-code-1");
    expect(location).toContain("state=state-1");
    expect(store.createAuthorizationCode).toHaveBeenCalledWith({
      clientId: "mcp_abc",
      authUserId: "user-1",
      userEmail: "u@example.com",
      redirectUri: REDIRECT_URI,
      scope: "health:read health:write",
      codeChallenge: "challenge",
      resource: "https://app.test/mcp",
    });
    expect(cryptoMocks.verifyConsentToken).toHaveBeenCalledWith(
      "token",
      {
        clientId: "mcp_abc",
        redirectUri: REDIRECT_URI,
        scope: "health:read health:write",
        state: "state-1",
        codeChallenge: "challenge",
        resource: "https://app.test/mcp",
      },
      "test-signing-secret",
    );
  });
});
