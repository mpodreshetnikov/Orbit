import { MCP_DEFAULT_SCOPE, MCP_SUPPORTED_SCOPES } from "./config";
import type { OAuthClientRow } from "./oauth-store";

/**
 * Validation of an inbound `/oauth/authorize` request.
 *
 * The critical distinction here is between two failure modes:
 *
 *  - **fatal** -- the `client_id` is unknown or the `redirect_uri` is not one
 *    the client registered. We must NOT redirect, because we have no
 *    trustworthy place to redirect to; bouncing the user to an attacker-chosen
 *    URL would make this an open redirector. Render an error page instead.
 *    (RFC 6749 section 4.1.2.1.)
 *
 *  - **redirect** -- the client and redirect URI check out but something else
 *    is wrong. The error goes back to the client as query parameters, and
 *    `state` must be echoed so the client can correlate it.
 */

export type AuthorizeValidation =
  | { kind: "ok"; request: ValidatedAuthorizeRequest }
  | { kind: "fatal"; error: string; description: string }
  | {
      kind: "redirect";
      redirectUri: string;
      error: string;
      description: string;
      state: string | null;
    };

export interface ValidatedAuthorizeRequest {
  clientId: string;
  client: OAuthClientRow;
  redirectUri: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
}

/**
 * Registered redirect URIs are matched exactly, byte for byte. No prefix
 * matching, no trailing-slash tolerance, no case folding of the path -- each of
 * those has been a real-world token-theft vector.
 */
function isRegisteredRedirectUri(client: OAuthClientRow, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

function intersectScopes(requested: string | null, clientScope: string): string {
  if (!requested?.trim()) {
    return clientScope || MCP_DEFAULT_SCOPE;
  }

  const allowed = new Set(clientScope.split(/\s+/).filter(Boolean));
  const granted = requested
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (scope) => allowed.has(scope) && (MCP_SUPPORTED_SCOPES as readonly string[]).includes(scope),
    );

  return granted.join(" ");
}

export function validateAuthorizeRequest(
  params: URLSearchParams,
  client: OAuthClientRow | null,
): AuthorizeValidation {
  const clientId = params.get("client_id");
  if (!clientId) {
    return {
      kind: "fatal",
      error: "invalid_request",
      description: "Missing client_id.",
    };
  }

  if (!client) {
    return {
      kind: "fatal",
      error: "invalid_client",
      description: "Unknown or disabled client_id. Re-register the connector and try again.",
    };
  }

  const redirectUri = params.get("redirect_uri");
  if (!redirectUri) {
    return {
      kind: "fatal",
      error: "invalid_request",
      description: "Missing redirect_uri.",
    };
  }

  if (!isRegisteredRedirectUri(client, redirectUri)) {
    return {
      kind: "fatal",
      error: "invalid_request",
      description: "redirect_uri does not match any URI registered for this client.",
    };
  }

  // Past this point the redirect target is trusted, so errors travel back to
  // the client rather than being rendered.
  const state = params.get("state");

  const responseType = params.get("response_type");
  if (responseType !== "code") {
    return {
      kind: "redirect",
      redirectUri,
      state,
      error: "unsupported_response_type",
      description: "Only the authorization code flow is supported.",
    };
  }

  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge) {
    return {
      kind: "redirect",
      redirectUri,
      state,
      error: "invalid_request",
      description: "PKCE is required: code_challenge is missing.",
    };
  }

  const codeChallengeMethod = params.get("code_challenge_method");
  if (codeChallengeMethod !== "S256") {
    return {
      kind: "redirect",
      redirectUri,
      state,
      error: "invalid_request",
      description: "code_challenge_method must be S256.",
    };
  }

  const scope = intersectScopes(params.get("scope"), client.scope);
  if (!scope) {
    return {
      kind: "redirect",
      redirectUri,
      state,
      error: "invalid_scope",
      description: "None of the requested scopes are available to this client.",
    };
  }

  return {
    kind: "ok",
    request: {
      clientId,
      client,
      redirectUri,
      scope,
      state,
      codeChallenge,
      resource: params.get("resource"),
    },
  };
}

/** Builds the client-bound error redirect for a `redirect`-kind validation failure. */
export function buildErrorRedirectUrl(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

export function buildSuccessRedirectUrl(
  redirectUri: string,
  code: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

/**
 * Redirect URIs accepted at registration time.
 *
 * `https` everywhere, with an exception for loopback so a locally-running
 * client (Claude Code, MCP Inspector) can complete the flow. Fragments are
 * rejected outright -- RFC 6749 forbids them and they break exact matching.
 */
export function isAcceptableRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.hash) {
    return false;
  }

  if (url.protocol === "https:") {
    return true;
  }

  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }

  return false;
}
