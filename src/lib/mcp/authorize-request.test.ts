import { describe, expect, it } from "vitest";
import {
  buildErrorRedirectUrl,
  buildSuccessRedirectUrl,
  isAcceptableRedirectUri,
  validateAuthorizeRequest,
} from "./authorize-request";
import type { OAuthClientRow } from "./oauth-store";

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const client: OAuthClientRow = {
  client_id: "mcp_abc",
  client_name: "Claude",
  redirect_uris: [REDIRECT_URI],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: "health:read health:write",
  disabled_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

function params(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    client_id: "mcp_abc",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: "challenge-value",
    code_challenge_method: "S256",
    scope: "health:read health:write",
    state: "state-1",
  };
  const merged = { ...base, ...overrides };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null) search.set(key, value);
  }
  return search;
}

describe("validateAuthorizeRequest", () => {
  it("accepts a well-formed request", () => {
    const result = validateAuthorizeRequest(params(), client);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.request.clientId).toBe("mcp_abc");
    expect(result.request.redirectUri).toBe(REDIRECT_URI);
    expect(result.request.scope).toBe("health:read health:write");
    expect(result.request.state).toBe("state-1");
  });

  // An unknown client or unregistered redirect target must never produce a
  // redirect, or the endpoint becomes an open redirector.
  it("is fatal, not a redirect, for an unknown client", () => {
    const result = validateAuthorizeRequest(params(), null);
    expect(result.kind).toBe("fatal");
  });

  it("is fatal, not a redirect, for an unregistered redirect_uri", () => {
    const result = validateAuthorizeRequest(
      params({ redirect_uri: "https://evil.example/steal" }),
      client,
    );
    expect(result.kind).toBe("fatal");
  });

  it("matches redirect_uri exactly rather than by prefix", () => {
    const sneaky = validateAuthorizeRequest(
      params({ redirect_uri: `${REDIRECT_URI}/../../evil` }),
      client,
    );
    expect(sneaky.kind).toBe("fatal");

    const trailingSlash = validateAuthorizeRequest(
      params({ redirect_uri: `${REDIRECT_URI}/` }),
      client,
    );
    expect(trailingSlash.kind).toBe("fatal");
  });

  it.each([
    ["missing client_id", { client_id: null }],
    ["missing redirect_uri", { redirect_uri: null }],
  ])("is fatal when %s", (_label, overrides) => {
    const result = validateAuthorizeRequest(params(overrides), client);
    expect(result.kind).toBe("fatal");
  });

  it.each([
    ["response_type is not code", { response_type: "token" }, "unsupported_response_type"],
    ["code_challenge is missing", { code_challenge: null }, "invalid_request"],
    ["code_challenge_method is plain", { code_challenge_method: "plain" }, "invalid_request"],
    ["code_challenge_method is absent", { code_challenge_method: null }, "invalid_request"],
  ])("redirects with %s", (_label, overrides, expectedError) => {
    const result = validateAuthorizeRequest(params(overrides), client);

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.error).toBe(expectedError);
    // state must survive so the client can correlate the failure.
    expect(result.state).toBe("state-1");
  });

  it("narrows the granted scope to what the client registered", () => {
    const narrow = { ...client, scope: "health:read" };
    const result = validateAuthorizeRequest(params({ scope: "health:read health:write" }), narrow);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.request.scope).toBe("health:read");
  });

  it("ignores scopes this server does not implement", () => {
    const result = validateAuthorizeRequest(
      params({ scope: "health:read admin:everything" }),
      client,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.request.scope).toBe("health:read");
  });

  it("rejects a request whose scopes are all unavailable", () => {
    const result = validateAuthorizeRequest(params({ scope: "admin:everything" }), client);

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.error).toBe("invalid_scope");
  });

  it("falls back to the client's full scope when none is requested", () => {
    const result = validateAuthorizeRequest(params({ scope: null }), client);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.request.scope).toBe("health:read health:write");
  });
});

describe("redirect builders", () => {
  it("carries the code and state back to the client", () => {
    const url = new URL(buildSuccessRedirectUrl(REDIRECT_URI, "code-1", "state-1"));
    expect(url.searchParams.get("code")).toBe("code-1");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("omits state when the client did not send one", () => {
    const url = new URL(buildSuccessRedirectUrl(REDIRECT_URI, "code-1", null));
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("preserves query parameters already present on the redirect URI", () => {
    const url = new URL(buildSuccessRedirectUrl(`${REDIRECT_URI}?tenant=acme`, "code-1", null));
    expect(url.searchParams.get("tenant")).toBe("acme");
    expect(url.searchParams.get("code")).toBe("code-1");
  });

  it("encodes error responses", () => {
    const url = new URL(
      buildErrorRedirectUrl(REDIRECT_URI, "invalid_request", "PKCE is required.", "state-1"),
    );
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(url.searchParams.get("error_description")).toBe("PKCE is required.");
    expect(url.searchParams.get("state")).toBe("state-1");
  });
});

describe("isAcceptableRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:6274/oauth/callback",
    "http://127.0.0.1:8080/cb",
  ])("accepts %s", (value) => {
    expect(isAcceptableRedirectUri(value)).toBe(true);
  });

  it.each([
    ["plaintext http on a public host", "http://evil.example/cb"],
    ["a fragment", "https://claude.ai/cb#frag"],
    ["a non-http scheme", "javascript:alert(1)"],
    ["a data URL", "data:text/html,hi"],
    ["nonsense", "not-a-url"],
  ])("rejects %s", (_label, value) => {
    expect(isAcceptableRedirectUri(value)).toBe(false);
  });
});
