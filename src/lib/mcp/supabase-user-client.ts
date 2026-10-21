import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabaseAnonKey, getSupabaseJwtSecret, getSupabaseUrl } from "./config";
import { mintSupabaseUserJwt } from "./crypto";
import type { McpAuthExtra } from "./verify-token";

/**
 * Builds the Supabase client a tool call runs its queries through.
 *
 * This is the single most important function in the MCP server from a security
 * standpoint. Every query a tool makes goes through a client carrying a
 * freshly-minted, five-minute JWT for the granting user -- so Postgres
 * evaluates row-level security exactly as it does for that same person in the
 * browser. `public.is_allowed_user()`, the predicate guarding every health
 * table, reads `auth.uid()` and `auth.email()`, both of which come from this
 * token.
 *
 * The service-role key is never used for health data. If you find yourself
 * reaching for it in a tool, that is a bug: it bypasses RLS entirely and would
 * silently fail to inherit any future tightening of the policies.
 */
export function createUserScopedSupabaseClient(auth: McpAuthExtra): SupabaseClient<Database> {
  return createClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${mintUserScopedJwt(auth)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mintUserScopedJwt(auth: McpAuthExtra): string {
  return mintSupabaseUserJwt({
    userId: auth.authUserId,
    email: auth.userEmail,
    supabaseUrl: getSupabaseUrl(),
    secret: getSupabaseJwtSecret(),
  });
}

/**
 * Calls an edge function as the granting user, with the same five-minute token the client above
 * carries. The function authenticates that token and applies the allowlist itself, so this is the
 * browser's own call made from the server -- not a way around either.
 *
 * Resolves with whatever the function answered, error statuses included: the caller decides what
 * a refusal means. Rejects only when the function could not be reached at all.
 */
export async function invokeEdgeFunctionAsUser(
  auth: McpAuthExtra,
  name: string,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(`${getSupabaseUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mintUserScopedJwt(auth)}`,
      apikey: getSupabaseAnonKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Not JSON -- a gateway error page, say. Handed back as text for the caller to report.
  }
  return { status: response.status, payload };
}
