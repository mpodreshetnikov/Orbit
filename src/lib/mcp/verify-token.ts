import type { GrantRow } from "./oauth-store";
import { findGrantByAccessToken, isGrantUserAllowed, touchGrant } from "./oauth-store";
import { getPublicOrigin, getResourceIdentifier } from "./config";
import { sha256Hex } from "./crypto";
import { hashMcpUserId, logMcpAuthAccepted, logMcpAuthRejected } from "./audit";

/**
 * Resolves an inbound bearer token to the grant behind it.
 *
 * This runs on the hot path of every MCP request and deliberately does as
 * little as possible. `withMcpAuth` converts *any* thrown error into a 401
 * challenge, which would send the client off to re-run the whole OAuth dance --
 * a terrible response to, say, a momentary database blip. So the contract here
 * is narrow: return the auth info, or return undefined for a genuine auth
 * failure, and let real infrastructure errors surface inside the tool handler
 * instead, where they read as tool errors.
 *
 * Note that no Supabase credential is stored or exchanged here. The grant
 * carries a user id and email; the short-lived Supabase JWT is minted later,
 * per tool call, in `supabase-user-client.ts`.
 *
 * Every accept and reject emits a structured audit line (T-0019) so probing and
 * connector use are visible in Grafana without logging the bearer itself.
 */

export interface McpAuthExtra extends Record<string, unknown> {
  grantId: string;
  authUserId: string;
  userEmail: string;
  /** The app's public origin, for links a tool hands back to the owner (the record's review screen). */
  appOrigin?: string;
}

export interface McpAuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: URL;
  extra: McpAuthExtra;
}

function tokenHashPrefix(bearerToken: string): string {
  return sha256Hex(bearerToken).slice(0, 8);
}

function rejectReasonForGrant(
  grant: GrantRow,
  now: Date = new Date(),
): "revoked" | "expired" | null {
  if (grant.revoked_at) return "revoked";
  // Inclusive: a token that expires at exactly `now` is already unusable.
  if (new Date(grant.access_token_expires_at) <= now) return "expired";
  return null;
}

function mcpAuthElapsedMs(startedAt: number, now: number = performance.now()): number {
  return now - startedAt;
}

/** Split OAuth scope string into tokens; collapses runs of whitespace. */
export function splitMcpScopes(scope: string): string[] {
  // Stryker disable next-line Regex: `\s` vs `\s+` is equivalent after filter(Boolean)
  return scope.split(/\s+/).filter(Boolean);
}

export async function verifyMcpBearerToken(
  request: Request,
  bearerToken?: string,
): Promise<McpAuthInfo | undefined> {
  const startedAt = performance.now();

  if (!bearerToken) {
    logMcpAuthRejected({
      reason: "missing_token",
      durationMs: mcpAuthElapsedMs(startedAt),
    });
    return undefined;
  }

  const grant = await findGrantByAccessToken(bearerToken);
  if (!grant) {
    logMcpAuthRejected({
      reason: "unknown",
      durationMs: mcpAuthElapsedMs(startedAt),
      tokenHashPrefix: tokenHashPrefix(bearerToken),
    });
    return undefined;
  }

  const unusable = rejectReasonForGrant(grant);
  if (unusable) {
    logMcpAuthRejected({
      reason: unusable,
      durationMs: mcpAuthElapsedMs(startedAt),
      grantId: grant.id,
      clientId: grant.client_id,
      userIdHash: hashMcpUserId(grant.auth_user_id),
      tokenHashPrefix: tokenHashPrefix(bearerToken),
    });
    return undefined;
  }

  // A user removed from the allowlist keeps a syntactically valid token. RLS
  // would already return nothing, but answering 401 is far clearer than a
  // stream of mysteriously empty results.
  if (!(await isGrantUserAllowed(grant))) {
    logMcpAuthRejected({
      reason: "not_allowlisted",
      durationMs: mcpAuthElapsedMs(startedAt),
      grantId: grant.id,
      clientId: grant.client_id,
      userIdHash: hashMcpUserId(grant.auth_user_id),
      tokenHashPrefix: tokenHashPrefix(bearerToken),
    });
    return undefined;
  }

  // Best-effort activity stamp; never block or fail the request on it.
  void touchGrant(grant.id).catch(() => {});

  logMcpAuthAccepted({
    grantId: grant.id,
    clientId: grant.client_id,
    userIdHash: hashMcpUserId(grant.auth_user_id),
    durationMs: mcpAuthElapsedMs(startedAt),
  });

  const expiresAtMs = new Date(grant.access_token_expires_at).getTime();
  return {
    token: bearerToken,
    clientId: grant.client_id,
    scopes: splitMcpScopes(grant.scope),
    expiresAt: Math.floor(expiresAtMs / 1000),
    resource: new URL(getResourceIdentifier(request)),
    extra: {
      grantId: grant.id,
      authUserId: grant.auth_user_id,
      userEmail: grant.user_email,
      appOrigin: getPublicOrigin(request),
    },
  };
}
