import { MCP_SUPPORTED_SCOPES, getIssuer, getResourceIdentifier } from "./config";

/**
 * The two discovery documents an MCP client fetches before it can authenticate.
 *
 * A client walks the chain: it calls `/api/mcp` unauthenticated, reads the
 * `resource_metadata` URL out of the 401's `WWW-Authenticate` header, fetches
 * the protected-resource document (RFC 9728) to learn which authorization
 * server to use, then fetches that server's metadata (RFC 8414) to learn the
 * registration, authorize and token endpoints.
 *
 * Every URL below must use the same origin string, or clients reject the
 * metadata as inconsistent.
 */

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  revocation_endpoint_auth_methods_supported: string[];
  service_documentation?: string;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}

export function buildAuthorizationServerMetadata(request: Request): AuthorizationServerMetadata {
  const issuer = getIssuer(request);

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // PKCE is mandatory: no `plain`, and no implicit flow.
    code_challenge_methods_supported: ["S256"],
    // Clients are public (they cannot keep a secret), so they authenticate at
    // the token endpoint with PKCE alone.
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
  };
}

export function buildProtectedResourceMetadata(request: Request): ProtectedResourceMetadata {
  return {
    resource: getResourceIdentifier(request),
    authorization_servers: [getIssuer(request)],
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

/**
 * Discovery documents are fetched cross-origin by browser-based clients, so
 * they need permissive CORS. They contain no secrets.
 */
export const METADATA_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

export function metadataJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
      ...METADATA_CORS_HEADERS,
    },
  });
}

export function metadataPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: METADATA_CORS_HEADERS });
}
