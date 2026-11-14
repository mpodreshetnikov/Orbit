import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  revokeGrantByToken: vi.fn(),
}));

vi.mock("@/lib/mcp/oauth-store", () => store);

async function post(init: { contentType?: string; body: string }) {
  const { POST } = await import("./route");
  return POST(
    new Request("https://app.test/api/oauth/revoke", {
      method: "POST",
      headers: init.contentType ? { "content-type": init.contentType } : undefined,
      body: init.body,
    }),
  );
}

describe("POST /api/oauth/revoke", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MCP_SERVER_ENABLED", "1");
    store.revokeGrantByToken.mockReset();
    store.revokeGrantByToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("404s when the MCP server is disabled", async () => {
    vi.stubEnv("MCP_SERVER_ENABLED", "");
    const response = await post({
      contentType: "application/json",
      body: JSON.stringify({ token: "access-1" }),
    });
    expect(response.status).toBe(404);
    expect(store.revokeGrantByToken).not.toHaveBeenCalled();
  });

  it("revokes a token from a JSON body", async () => {
    const response = await post({
      contentType: "application/json",
      body: JSON.stringify({ token: "access-1" }),
    });
    expect(response.status).toBe(200);
    expect(store.revokeGrantByToken).toHaveBeenCalledWith("access-1");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns 200 without revoking when JSON cannot be parsed", async () => {
    const response = await post({
      contentType: "application/json",
      body: "{not-json",
    });
    expect(response.status).toBe(200);
    expect(store.revokeGrantByToken).not.toHaveBeenCalled();
  });

  it("revokes a token from a form-urlencoded body", async () => {
    const response = await post({
      contentType: "application/x-www-form-urlencoded",
      body: "token=refresh-1",
    });
    expect(response.status).toBe(200);
    expect(store.revokeGrantByToken).toHaveBeenCalledWith("refresh-1");
  });

  it("returns 200 without revoking when the token is missing", async () => {
    const response = await post({
      contentType: "application/x-www-form-urlencoded",
      body: "token_type_hint=access_token",
    });
    expect(response.status).toBe(200);
    expect(store.revokeGrantByToken).not.toHaveBeenCalled();
  });
});

describe("OPTIONS /api/oauth/revoke", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("answers the CORS preflight", async () => {
    const { OPTIONS } = await import("./route");
    const response = await OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
