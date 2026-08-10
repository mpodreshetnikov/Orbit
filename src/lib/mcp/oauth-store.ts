import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  MAX_REGISTERED_CLIENTS,
  REFRESH_TOKEN_TTL_SECONDS,
  UNUSED_CLIENT_TTL_MS,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "./config";
import { generateClientId, generateToken, sha256Hex } from "./crypto";

/**
 * Service-role access to the three MCP OAuth tables.
 *
 * These tables have RLS enabled and no policies, so the service role is the
 * only way in -- and this module is the only place that key is used for the MCP
 * feature. Health data is never read here; that goes through a user-scoped
 * client so RLS applies (see `supabase-user-client.ts`).
 *
 * The tables are not in `supabase/db/database.types.ts` until someone runs
 * `just supabase-local-artifacts-refresh` against a local database, so the row
 * shapes are declared here and the client is intentionally left ungenericized.
 */

export interface OAuthClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
  disabled_at: string | null;
  created_at: string;
}

export interface AuthorizationCodeRow {
  id: string;
  code_hash: string;
  client_id: string;
  auth_user_id: string;
  user_email: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
  expires_at: string;
  consumed_at: string | null;
  issued_grant_id: string | null;
}

export interface GrantRow {
  id: string;
  client_id: string;
  auth_user_id: string;
  user_email: string;
  scope: string;
  access_token_hash: string;
  access_token_expires_at: string;
  refresh_token_hash: string | null;
  refresh_token_expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope: string;
  grantId: string;
}

let cachedClient: SupabaseClient | null = null;

export function getOAuthAdminClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}

/** Test seam: drops the memoized admin client so env stubs take effect. */
export function resetOAuthAdminClient(): void {
  cachedClient = null;
}

// ============================================================================
// Clients
// ============================================================================

export async function countClients(client = getOAuthAdminClient()): Promise<number> {
  const { count, error } = await client
    .from("mcp_oauth_clients")
    .select("client_id", { count: "exact", head: true });

  if (error) {
    throw new Error(`Failed to count OAuth clients: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Deletes registrations that were never used and have gone stale.
 *
 * The cap below exists to bound abuse of an unauthenticated endpoint, but on
 * its own it is a permanent lockout: anyone could submit enough registrations
 * to block every future connector, and there would be no way back. Pruning
 * abandoned rows first makes the bound self-healing.
 *
 * Only clients with no grant attached are eligible, so a connector someone
 * actually completed the flow with is never removed, however old.
 */
export async function pruneUnusedClients(
  client = getOAuthAdminClient(),
  olderThanMs = UNUSED_CLIENT_TTL_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  const { data: candidates, error } = await client
    .from("mcp_oauth_clients")
    .select("client_id, mcp_oauth_grants(id)")
    .lt("created_at", cutoff);

  if (error) {
    // Pruning is opportunistic; never fail a registration because of it.
    return 0;
  }

  const abandoned = (
    (candidates ?? []) as Array<{ client_id: string; mcp_oauth_grants: Array<{ id: string }> }>
  )
    .filter((row) => (row.mcp_oauth_grants ?? []).length === 0)
    .map((row) => row.client_id);

  if (abandoned.length === 0) {
    return 0;
  }

  await client.from("mcp_oauth_clients").delete().in("client_id", abandoned);
  return abandoned.length;
}

export async function registerClient(
  input: {
    clientName: string | null;
    redirectUris: string[];
    scope: string;
    tokenEndpointAuthMethod: string;
    grantTypes: string[];
    responseTypes: string[];
    clientUri?: string | null;
    logoUri?: string | null;
    policyUri?: string | null;
    tosUri?: string | null;
    softwareId?: string | null;
    softwareVersion?: string | null;
  },
  client = getOAuthAdminClient(),
): Promise<OAuthClientRow> {
  if ((await countClients(client)) >= MAX_REGISTERED_CLIENTS) {
    // Reclaim abandoned registrations before refusing, so the cap bounds abuse
    // without becoming a permanent lockout on an unauthenticated endpoint.
    await pruneUnusedClients(client);

    if ((await countClients(client)) >= MAX_REGISTERED_CLIENTS) {
      throw new Error(
        `Refusing to register another OAuth client: the cap of ${MAX_REGISTERED_CLIENTS} in-use registrations has been reached. Revoke a connector you no longer use and try again.`,
      );
    }
  }

  const { data, error } = await client
    .from("mcp_oauth_clients")
    .insert({
      client_id: generateClientId(),
      client_name: input.clientName,
      redirect_uris: input.redirectUris,
      scope: input.scope,
      token_endpoint_auth_method: input.tokenEndpointAuthMethod,
      grant_types: input.grantTypes,
      response_types: input.responseTypes,
      client_uri: input.clientUri ?? null,
      logo_uri: input.logoUri ?? null,
      policy_uri: input.policyUri ?? null,
      tos_uri: input.tosUri ?? null,
      software_id: input.softwareId ?? null,
      software_version: input.softwareVersion ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to register OAuth client: ${error?.message ?? "no row returned"}`);
  }
  return data as OAuthClientRow;
}

export async function getClient(
  clientId: string,
  client = getOAuthAdminClient(),
): Promise<OAuthClientRow | null> {
  const { data, error } = await client
    .from("mcp_oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .is("disabled_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load OAuth client: ${error.message}`);
  }
  return (data as OAuthClientRow | null) ?? null;
}

// ============================================================================
// Authorization codes
// ============================================================================

export async function createAuthorizationCode(
  input: {
    clientId: string;
    authUserId: string;
    userEmail: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    resource: string | null;
  },
  client = getOAuthAdminClient(),
): Promise<string> {
  const code = generateToken();
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();

  const { error } = await client.from("mcp_oauth_authorization_codes").insert({
    code_hash: sha256Hex(code),
    client_id: input.clientId,
    auth_user_id: input.authUserId,
    user_email: input.userEmail,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: input.resource,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Failed to create authorization code: ${error.message}`);
  }
  return code;
}

/**
 * Atomically claims an authorization code.
 *
 * The `consumed_at IS NULL` guard lives in the UPDATE rather than in a
 * read-then-write, so two concurrent exchanges of the same code cannot both
 * succeed -- only one of them matches a row.
 *
 * Returns `{ status: "replayed" }` when the code exists but was already used,
 * which the caller must treat as an attack signal and respond to by revoking
 * whatever the first exchange issued.
 */
export async function consumeAuthorizationCode(
  code: string,
  client = getOAuthAdminClient(),
): Promise<
  | { status: "ok"; row: AuthorizationCodeRow }
  | { status: "not_found" }
  | { status: "replayed"; issuedGrantId: string | null }
> {
  const codeHash = sha256Hex(code);

  const { data, error } = await client
    .from("mcp_oauth_authorization_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to consume authorization code: ${error.message}`);
  }

  if (data) {
    return { status: "ok", row: data as AuthorizationCodeRow };
  }

  // Nothing matched: either the code never existed / has expired, or it was
  // already spent. Distinguishing the two lets us punish replay specifically.
  const { data: existing } = await client
    .from("mcp_oauth_authorization_codes")
    .select("id, issued_grant_id, consumed_at")
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (existing && (existing as { consumed_at: string | null }).consumed_at) {
    return {
      status: "replayed",
      issuedGrantId: (existing as { issued_grant_id: string | null }).issued_grant_id,
    };
  }

  return { status: "not_found" };
}

export async function linkCodeToGrant(
  codeId: string,
  grantId: string,
  client = getOAuthAdminClient(),
): Promise<void> {
  await client
    .from("mcp_oauth_authorization_codes")
    .update({ issued_grant_id: grantId })
    .eq("id", codeId);
}

// ============================================================================
// Grants
// ============================================================================

export async function issueGrant(
  input: {
    clientId: string;
    authUserId: string;
    userEmail: string;
    scope: string;
    rotatedFrom?: string | null;
  },
  client = getOAuthAdminClient(),
): Promise<IssuedTokens> {
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const now = Date.now();

  const { data, error } = await client
    .from("mcp_oauth_grants")
    .insert({
      client_id: input.clientId,
      auth_user_id: input.authUserId,
      user_email: input.userEmail,
      scope: input.scope,
      access_token_hash: sha256Hex(accessToken),
      access_token_expires_at: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      refresh_token_hash: sha256Hex(refreshToken),
      refresh_token_expires_at: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
      rotated_from: input.rotatedFrom ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to issue OAuth grant: ${error?.message ?? "no row returned"}`);
  }

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    scope: input.scope,
    grantId: (data as { id: string }).id,
  };
}

export async function findGrantByAccessToken(
  accessToken: string,
  client = getOAuthAdminClient(),
): Promise<GrantRow | null> {
  const { data, error } = await client
    .from("mcp_oauth_grants")
    .select("*")
    .eq("access_token_hash", sha256Hex(accessToken))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up OAuth grant: ${error.message}`);
  }
  return (data as GrantRow | null) ?? null;
}

export async function findGrantByRefreshToken(
  refreshToken: string,
  client = getOAuthAdminClient(),
): Promise<GrantRow | null> {
  const { data, error } = await client
    .from("mcp_oauth_grants")
    .select("*")
    .eq("refresh_token_hash", sha256Hex(refreshToken))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up OAuth grant: ${error.message}`);
  }
  return (data as GrantRow | null) ?? null;
}

/**
 * Atomically claims a grant for rotation.
 *
 * A read-then-write would let two concurrent refreshes with the same token both
 * pass the `revoked_at IS NULL` check and both mint a replacement, leaving two
 * live token families and defeating reuse detection. The guard lives in the
 * UPDATE, so exactly one caller matches a row; the loser gets `null` and is
 * treated as a replay.
 */
export async function claimGrantForRotation(
  grantId: string,
  client = getOAuthAdminClient(),
): Promise<GrantRow | null> {
  const { data, error } = await client
    .from("mcp_oauth_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim OAuth grant for rotation: ${error.message}`);
  }
  return (data as GrantRow | null) ?? null;
}

export async function revokeGrant(grantId: string, client = getOAuthAdminClient()): Promise<void> {
  const { error } = await client
    .from("mcp_oauth_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null);

  if (error) {
    throw new Error(`Failed to revoke OAuth grant: ${error.message}`);
  }
}

/** Revokes a grant and everything subsequently rotated out of it. */
export async function revokeGrantChain(
  grantId: string,
  client = getOAuthAdminClient(),
): Promise<void> {
  await revokeGrant(grantId, client);

  const { data } = await client
    .from("mcp_oauth_grants")
    .select("id")
    .eq("rotated_from", grantId)
    .is("revoked_at", null);

  for (const row of (data ?? []) as Array<{ id: string }>) {
    await revokeGrantChain(row.id, client);
  }
}

export async function revokeGrantByToken(
  token: string,
  client = getOAuthAdminClient(),
): Promise<void> {
  const tokenHash = sha256Hex(token);
  const { data } = await client
    .from("mcp_oauth_grants")
    .select("id")
    .or(`access_token_hash.eq.${tokenHash},refresh_token_hash.eq.${tokenHash}`)
    .maybeSingle();

  if (data) {
    await revokeGrantChain((data as { id: string }).id, client);
  }
}

export async function touchGrant(grantId: string, client = getOAuthAdminClient()): Promise<void> {
  await client
    .from("mcp_oauth_grants")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", grantId);
}

/**
 * Whether the user behind a grant is still on the allowlist.
 *
 * RLS already stops a de-allowlisted user from reading anything, but checking
 * here turns that into a clean 401 (prompting re-auth) instead of a confusing
 * stream of empty results.
 */
export async function isGrantUserAllowed(
  grant: Pick<GrantRow, "auth_user_id" | "user_email">,
  client = getOAuthAdminClient(),
): Promise<boolean> {
  const { data, error } = await client
    .from("allowed_users")
    .select("id")
    .or(`auth_user_id.eq.${grant.auth_user_id},email.eq.${grant.user_email}`)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check allowlist membership: ${error.message}`);
  }
  return Boolean(data);
}

export async function listGrantsForUser(
  authUserId: string,
  client = getOAuthAdminClient(),
): Promise<Array<GrantRow & { client_name: string | null }>> {
  const { data, error } = await client
    .from("mcp_oauth_grants")
    .select("*, mcp_oauth_clients(client_name)")
    .eq("auth_user_id", authUserId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list OAuth grants: ${error.message}`);
  }

  return (
    (data ?? []) as Array<GrantRow & { mcp_oauth_clients: { client_name: string | null } | null }>
  ).map((row) => ({ ...row, client_name: row.mcp_oauth_clients?.client_name ?? null }));
}
