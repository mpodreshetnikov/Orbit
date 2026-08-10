import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findGrantByAccessToken: vi.fn(),
  isGrantUserAllowed: vi.fn(),
  touchGrant: vi.fn(),
}));

vi.mock("@/lib/mcp/oauth-store", () => store);

const VALID_GRANT = {
  id: "grant-1",
  client_id: "mcp_abc",
  auth_user_id: "11111111-1111-1111-1111-111111111111",
  user_email: "u@example.com",
  scope: "health:read health:write",
  access_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
};

async function callMcp(
  body: unknown,
  { token, headers = {} }: { token?: string; headers?: Record<string, string> } = {},
) {
  const { POST } = await import("./route");
  const response = await POST(
    new Request("https://app.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
  return response;
}

/** The handler may answer as JSON or as a single SSE frame; normalize both. */
async function readJsonRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line!.slice("data:".length).trim());
  }
  return JSON.parse(text);
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

describe("POST /api/mcp", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_JWT_SECRET", "jwt-secret");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

    store.findGrantByAccessToken.mockReset();
    store.isGrantUserAllowed.mockReset();
    store.touchGrant.mockReset();
    store.findGrantByAccessToken.mockResolvedValue(VALID_GRANT);
    store.isGrantUserAllowed.mockResolvedValue(true);
    store.touchGrant.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("authentication challenge", () => {
    it("answers an unauthenticated call with 401 and points at the resource metadata", async () => {
      const response = await callMcp(INITIALIZE);

      expect(response.status).toBe(401);
      const challenge = response.headers.get("www-authenticate");
      // This header is the client's only clue about where to authenticate. If
      // it is missing, or if this ever became a 307 to /login, the connector
      // could never complete setup.
      expect(challenge).toBeTruthy();
      expect(challenge).toContain("Bearer");
      expect(challenge).toContain("/.well-known/oauth-protected-resource/api/mcp");
    });

    it.each([
      ["an unknown token", () => store.findGrantByAccessToken.mockResolvedValue(null)],
      [
        "a revoked grant",
        () =>
          store.findGrantByAccessToken.mockResolvedValue({
            ...VALID_GRANT,
            revoked_at: new Date().toISOString(),
          }),
      ],
      [
        "an expired grant",
        () =>
          store.findGrantByAccessToken.mockResolvedValue({
            ...VALID_GRANT,
            access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
          }),
      ],
      [
        "a user removed from the allowlist",
        () => store.isGrantUserAllowed.mockResolvedValue(false),
      ],
    ])("rejects %s with 401", async (_label, arrange) => {
      arrange();
      const response = await callMcp(INITIALIZE, { token: "some-token" });
      expect(response.status).toBe(401);
    });
  });

  describe("with a valid token", () => {
    it("completes the MCP handshake", async () => {
      const response = await callMcp(INITIALIZE, { token: "access-1" });
      expect(response.status).toBe(200);

      const message = await readJsonRpc(response);
      expect(message).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: { serverInfo: { name: "orbit-health" } },
      });
    });

    it("lists the Health tools", async () => {
      const response = await callMcp(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        { token: "access-1", headers: { "mcp-protocol-version": "2025-06-18" } },
      );

      expect(response.status).toBe(200);
      const message = (await readJsonRpc(response)) as {
        result?: { tools?: Array<{ name: string; description?: string; annotations?: unknown }> };
      };

      const tools = message.result?.tools ?? [];
      expect(tools.length).toBeGreaterThan(0);

      const names = tools.map((tool) => tool.name);
      expect(names).toContain("list_persons");
      // Duplicate names would silently shadow each other.
      expect(new Set(names).size).toBe(names.length);
      // A tool without a description is close to unusable for the model.
      for (const tool of tools) {
        expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      }
    });

    it("stamps activity without blocking the request", async () => {
      await callMcp(INITIALIZE, { token: "access-1" });
      expect(store.touchGrant).toHaveBeenCalledWith("grant-1");
    });
  });

  it("404s entirely when the MCP server is disabled", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "");
    const response = await callMcp(INITIALIZE, { token: "access-1" });
    expect(response.status).toBe(404);
  });
});
