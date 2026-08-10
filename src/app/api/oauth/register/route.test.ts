import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  registerClient: vi.fn(),
}));

vi.mock("@/lib/mcp/oauth-store", () => store);

async function post(body: unknown) {
  const { POST } = await import("./route");
  const response = await POST(
    new Request("https://app.test/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { response, body: await response.json().catch(() => null) };
}

describe("POST /api/oauth/register", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    store.registerClient.mockReset();
    store.registerClient.mockImplementation(async (input) => ({
      client_id: "mcp_generated",
      client_name: input.clientName,
      redirect_uris: input.redirectUris,
      grant_types: input.grantTypes,
      response_types: input.responseTypes,
      token_endpoint_auth_method: "none",
      scope: input.scope,
      created_at: "2026-08-09T00:00:00.000Z",
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers a client and returns its identifier", async () => {
    const { response, body } = await post({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });

    expect(response.status).toBe(201);
    expect(body.client_id).toBe("mcp_generated");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.scope).toBe("health:read health:write");
    expect(typeof body.client_id_issued_at).toBe("number");
  });

  it("accepts a loopback redirect so local clients can connect", async () => {
    const { response } = await post({
      client_name: "MCP Inspector",
      redirect_uris: ["http://localhost:6274/oauth/callback"],
    });

    expect(response.status).toBe(201);
  });

  it.each([
    ["plaintext http on a public host", ["http://evil.example/cb"]],
    ["a fragment", ["https://claude.ai/cb#x"]],
    ["a non-http scheme", ["javascript:alert(1)"]],
  ])("rejects %s", async (_label, redirectUris) => {
    const { response, body } = await post({ redirect_uris: redirectUris });

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
    expect(store.registerClient).not.toHaveBeenCalled();
  });

  it("rejects an empty redirect_uris list", async () => {
    const { response, body } = await post({ redirect_uris: [] });

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("rejects more redirect URIs than the cap allows", async () => {
    const { response } = await post({
      redirect_uris: Array.from({ length: 6 }, (_, i) => `https://claude.ai/cb${i}`),
    });

    expect(response.status).toBe(400);
  });

  it("rejects confidential clients", async () => {
    const { response, body } = await post({
      redirect_uris: ["https://claude.ai/cb"],
      token_endpoint_auth_method: "client_secret_basic",
    });

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("rejects a non-JSON body", async () => {
    const { response, body } = await post("not json");

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("surfaces the registration cap as a client error", async () => {
    store.registerClient.mockRejectedValue(new Error("Refusing to register another OAuth client"));

    const { response, body } = await post({ redirect_uris: ["https://claude.ai/cb"] });

    expect(response.status).toBe(400);
    expect(body.error_description).toContain("Refusing to register");
  });

  it("is fetchable cross-origin", async () => {
    const { response } = await post({ redirect_uris: ["https://claude.ai/cb"] });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const { OPTIONS } = await import("./route");
    expect((await OPTIONS()).status).toBe(204);
  });

  it("404s when the MCP server is disabled", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "");
    const { response } = await post({ redirect_uris: ["https://claude.ai/cb"] });
    expect(response.status).toBe(404);
  });
});
