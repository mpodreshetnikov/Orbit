import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /.well-known/oauth-authorization-server", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function metadata(headers: Record<string, string> = {}) {
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://app.test/.well-known/oauth-authorization-server", { headers }),
    );
    return { response, body: await response.json() };
  }

  it("points every endpoint at the same issuer origin", async () => {
    const { body } = await metadata();

    expect(body.issuer).toBe("https://app.test");
    expect(body.authorization_endpoint).toBe("https://app.test/oauth/authorize");
    expect(body.token_endpoint).toBe("https://app.test/api/oauth/token");
    expect(body.registration_endpoint).toBe("https://app.test/api/oauth/register");
    expect(body.revocation_endpoint).toBe("https://app.test/api/oauth/revoke");

    for (const url of [
      body.authorization_endpoint,
      body.token_endpoint,
      body.registration_endpoint,
      body.revocation_endpoint,
    ]) {
      expect(url.startsWith(`${body.issuer}/`)).toBe(true);
    }
  });

  it("requires PKCE S256 and offers no implicit flow", async () => {
    const { body } = await metadata();

    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("tracks the forwarded origin", async () => {
    const { body } = await metadata({
      "x-forwarded-host": "health.example.com",
      "x-forwarded-proto": "https",
    });

    expect(body.issuer).toBe("https://health.example.com");
    expect(body.token_endpoint).toBe("https://health.example.com/api/oauth/token");
  });

  it("404s when the MCP server is disabled", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "");
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://app.test/.well-known/oauth-authorization-server"),
    );

    expect(response.status).toBe(404);
  });
});
