/**
 * Configuration for the MCP connector: the OAuth authorization server and the
 * `/api/mcp` tool endpoint.
 *
 * Everything here is server-only. None of these names may ever gain a
 * `NEXT_PUBLIC_` prefix -- `SUPABASE_JWT_SECRET` in particular can mint a token
 * for any user, so it must never reach a client bundle.
 */

/** Scopes this server understands. Reads and writes are separable so a future client can ask for less. */
export const MCP_SCOPE_READ = "health:read";
export const MCP_SCOPE_WRITE = "health:write";
export const MCP_DEFAULT_SCOPE = `${MCP_SCOPE_READ} ${MCP_SCOPE_WRITE}`;
export const MCP_SUPPORTED_SCOPES = [MCP_SCOPE_READ, MCP_SCOPE_WRITE] as const;

/** Authorization codes are exchanged within seconds; a short window limits interception value. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;
/** Access tokens are long-lived so a connector keeps working; revocation is enforced per request against the grant row. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180;
/** The Supabase JWT minted per request. Short enough that a leaked one is near-worthless. */
export const SUPABASE_JWT_TTL_SECONDS = 300;
/** Consent form tokens must be used while the user is still on the page. */
export const CONSENT_TOKEN_TTL_SECONDS = 600;

/**
 * Cap on dynamically registered clients, so an unauthenticated endpoint cannot
 * be used to fill the table. Counted against *in-use* registrations: abandoned
 * ones are pruned first, so the cap bounds abuse without becoming a permanent
 * lockout.
 */
export const MAX_REGISTERED_CLIENTS = 50;
/** A registration that never completed a grant is abandoned after this long. */
export const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_REDIRECT_URIS_PER_CLIENT = 5;

export const MCP_ENDPOINT_PATH = "/api/mcp";
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

/**
 * Master switch. Every MCP and OAuth route 404s unless this is set, so a
 * preview or scratch deployment cannot be registered as a live connector
 * against production data.
 */
export function isMcpServerEnabled(): boolean {
  return process.env.MCP_SERVER_ENABLED === "1";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Legacy Supabase HS256 secret, used to mint the short-lived per-request user JWT. */
export function getSupabaseJwtSecret(): string {
  return requireEnv("SUPABASE_JWT_SECRET");
}

/** HMAC key protecting the consent form against parameter tampering. */
export function getOAuthSigningSecret(): string {
  return requireEnv("MCP_OAUTH_SIGNING_SECRET");
}

export function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function getSupabaseServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/**
 * The public origin this server is reachable at.
 *
 * Behind Vercel, `request.url` reflects the internal URL, so the forwarded
 * headers are the source of truth. `MCP_PUBLIC_ORIGIN` overrides both, which is
 * what you want when running behind a tunnel.
 *
 * The value must be byte-identical everywhere it appears -- the discovery
 * documents, the authorize/token URLs, and the resource identifier -- or the
 * client will reject the metadata as inconsistent.
 */
export function getPublicOrigin(request: Request): string {
  const override = process.env.MCP_PUBLIC_ORIGIN?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }

  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${forwardedHost.split(",")[0]?.trim()}`;
  }

  const forwarded = headers.get("forwarded");
  if (forwarded) {
    const host = /host="?([^;,"]+)"?/i.exec(forwarded)?.[1];
    const proto = /proto="?([^;,"]+)"?/i.exec(forwarded)?.[1] ?? "https";
    if (host) {
      return `${proto}://${host}`;
    }
  }

  return new URL(request.url).origin;
}

export function getIssuer(request: Request): string {
  return getPublicOrigin(request);
}

export function getResourceIdentifier(request: Request): string {
  return `${getPublicOrigin(request)}${MCP_ENDPOINT_PATH}`;
}
