import { isMcpServerEnabled } from "@/lib/mcp/config";
import { verifyPkceS256 } from "@/lib/mcp/crypto";
import {
  claimGrantForRotation,
  consumeAuthorizationCode,
  findGrantByRefreshToken,
  getClient,
  issueGrant,
  linkCodeToGrant,
  revokeGrantChain,
} from "@/lib/mcp/oauth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Token responses must never be cached anywhere.
      "cache-control": "no-store",
      pragma: "no-cache",
      ...CORS_HEADERS,
    },
  });
}

function oauthError(code: string, description: string, status = 400): Response {
  return json({ error: code, error_description: description }, status);
}

async function readParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  const body = await request.text();

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") params.set(key, value);
      }
      return params;
    } catch {
      return new URLSearchParams();
    }
  }

  // RFC 6749 mandates form encoding; JSON is accepted above because some
  // clients send it anyway.
  return new URLSearchParams(body);
}

export async function POST(request: Request) {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  const params = await readParams(request);
  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    return handleAuthorizationCode(params);
  }
  if (grantType === "refresh_token") {
    return handleRefreshToken(params);
  }

  return oauthError(
    "unsupported_grant_type",
    "Supported grant types are authorization_code and refresh_token.",
  );
}

async function handleAuthorizationCode(params: URLSearchParams): Promise<Response> {
  const code = params.get("code");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeVerifier = params.get("code_verifier");

  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return oauthError(
      "invalid_request",
      "code, client_id, redirect_uri and code_verifier are all required.",
    );
  }

  const claimed = await consumeAuthorizationCode(code);

  if (claimed.status === "replayed") {
    // A code being presented twice means it leaked. Everything the first
    // exchange produced is now suspect, so tear the whole chain down.
    if (claimed.issuedGrantId) {
      await revokeGrantChain(claimed.issuedGrantId);
    }
    return oauthError(
      "invalid_grant",
      "Authorization code has already been used. The tokens it issued have been revoked.",
    );
  }

  if (claimed.status === "not_found") {
    return oauthError("invalid_grant", "Authorization code is invalid or has expired.");
  }

  const row = claimed.row;

  // Bind the code to the client and redirect URI it was issued for, so a
  // stolen code cannot be redeemed by a different client.
  if (row.client_id !== clientId) {
    return oauthError("invalid_grant", "Authorization code was not issued to this client.");
  }
  if (row.redirect_uri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
  }
  if (!verifyPkceS256(codeVerifier, row.code_challenge)) {
    return oauthError("invalid_grant", "PKCE verification failed.");
  }

  const client = await getClient(clientId);
  if (!client) {
    return oauthError("invalid_client", "Unknown or disabled client.");
  }

  const tokens = await issueGrant({
    clientId: row.client_id,
    authUserId: row.auth_user_id,
    userEmail: row.user_email,
    scope: row.scope,
  });

  // Recorded so a later replay of this code knows what to revoke.
  await linkCodeToGrant(row.id, tokens.grantId);

  return json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresInSeconds,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope,
    },
    200,
  );
}

async function handleRefreshToken(params: URLSearchParams): Promise<Response> {
  const refreshToken = params.get("refresh_token");
  const clientId = params.get("client_id");

  if (!refreshToken) {
    return oauthError("invalid_request", "refresh_token is required.");
  }

  const grant = await findGrantByRefreshToken(refreshToken);
  if (!grant) {
    return oauthError("invalid_grant", "Refresh token is invalid.");
  }

  if (grant.revoked_at) {
    // Presenting a revoked refresh token is a replay signal: revoke whatever
    // was rotated out of it too.
    await revokeGrantChain(grant.id);
    return oauthError("invalid_grant", "Refresh token has been revoked.");
  }

  if (grant.refresh_token_expires_at && new Date(grant.refresh_token_expires_at) < new Date()) {
    return oauthError("invalid_grant", "Refresh token has expired.");
  }

  if (clientId && clientId !== grant.client_id) {
    return oauthError("invalid_grant", "Refresh token was not issued to this client.");
  }

  // Claim before issuing, not after. Two concurrent refreshes with the same
  // token would otherwise both pass the checks above and both mint a
  // replacement, leaving two live token families. The conditional update means
  // exactly one caller wins; the loser falls through to the replay branch.
  const claimed = await claimGrantForRotation(grant.id);
  if (!claimed) {
    await revokeGrantChain(grant.id);
    return oauthError(
      "invalid_grant",
      "Refresh token has already been used. The tokens it issued have been revoked.",
    );
  }

  const tokens = await issueGrant({
    clientId: claimed.client_id,
    authUserId: claimed.auth_user_id,
    userEmail: claimed.user_email,
    scope: claimed.scope,
    rotatedFrom: claimed.id,
  });

  return json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresInSeconds,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope,
    },
    200,
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
