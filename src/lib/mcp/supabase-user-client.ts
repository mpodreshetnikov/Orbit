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
  const supabaseUrl = getSupabaseUrl();

  const jwt = mintSupabaseUserJwt({
    userId: auth.authUserId,
    email: auth.userEmail,
    supabaseUrl,
    secret: getSupabaseJwtSecret(),
  });

  return createClient<Database>(supabaseUrl, getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
