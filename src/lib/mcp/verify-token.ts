import type { GrantRow } from "./oauth-store";
import { findGrantByAccessToken, isGrantUserAllowed, touchGrant } from "./oauth-store";
import { getResourceIdentifier } from "./config";

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
 */

export interface McpAuthExtra extends Record<string, unknown> {
  grantId: string;
  authUserId: string;
  userEmail: string;
}

export interface McpAuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: URL;
  extra: McpAuthExtra;
}

/** Auth failures that legitimately warrant a 401 and a fresh OAuth run. */
function isUsable(grant: GrantRow): boolean {
  if (grant.revoked_at) return false;
  if (new Date(grant.access_token_expires_at) <= new Date()) return false;
  return true;
}

export async function verifyMcpBearerToken(
  request: Request,
  bearerToken?: string,
): Promise<McpAuthInfo | undefined> {
  if (!bearerToken) {
    return undefined;
  }

  const grant = await findGrantByAccessToken(bearerToken);
  if (!grant || !isUsable(grant)) {
    return undefined;
  }

  // A user removed from the allowlist keeps a syntactically valid token. RLS
  // would already return nothing, but answering 401 is far clearer than a
  // stream of mysteriously empty results.
  if (!(await isGrantUserAllowed(grant))) {
    return undefined;
  }

  // Best-effort activity stamp; never block or fail the request on it.
  void touchGrant(grant.id).catch(() => {});

  return {
    token: bearerToken,
    clientId: grant.client_id,
    scopes: grant.scope.split(/\s+/).filter(Boolean),
    expiresAt: Math.floor(new Date(grant.access_token_expires_at).getTime() / 1000),
    resource: new URL(getResourceIdentifier(request)),
    extra: {
      grantId: grant.id,
      authUserId: grant.auth_user_id,
      userEmail: grant.user_email,
    },
  };
}
