import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /.well-known/oauth-protected-resource/api/mcp", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function get(url: string, headers: Record<string, string> = {}) {
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    const { GET } = await import("./route");
    return GET(new Request(url, { headers }));
  }

  it("advertises the MCP endpoint as the protected resource", async () => {
    const response = await get("https://app.test/.well-known/oauth-protected-resource/api/mcp");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resource).toBe("https://app.test/api/mcp");
    expect(body.authorization_servers).toEqual(["https://app.test"]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
    expect(body.scopes_supported).toEqual(["health:read", "health:write"]);
  });

  it("derives the public origin from proxy headers, not the internal URL", async () => {
    // On Vercel the request URL is the internal one; the forwarded headers are
    // what the client actually reached us on.
    const response = await get(
      "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp",
      {
        "x-forwarded-host": "health.example.com",
        "x-forwarded-proto": "https",
      },
    );
    const body = await response.json();

    expect(body.resource).toBe("https://health.example.com/api/mcp");
    expect(body.authorization_servers).toEqual(["https://health.example.com"]);
  });

  it("honours an explicit origin override", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://tunnel.example/");
    const { GET } = await import("./route");
    const body = await (
      await GET(new Request("http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"))
    ).json();

    expect(body.resource).toBe("https://tunnel.example/api/mcp");
  });

  it("is fetchable cross-origin", async () => {
    const response = await get("https://app.test/.well-known/oauth-protected-resource/api/mcp");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("404s when the MCP server is disabled", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "");
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://app.test/.well-known/oauth-protected-resource/api/mcp"),
    );

    expect(response.status).toBe(404);
  });
});
