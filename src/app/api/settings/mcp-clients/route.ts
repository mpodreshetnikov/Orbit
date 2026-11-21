import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { listGrantsForUser } from "@/lib/mcp/oauth-store";
import type { McpConnectedClient } from "@/types/mcp-clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists the signed-in user's live MCP connector grants for the settings UI.
 *
 * OAuth tables are service-role only (no RLS policies), so the browser cannot
 * read them directly — this route is the session-gated door.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const grants = await listGrantsForUser(user.id);
    const clients: McpConnectedClient[] = grants.map((grant) => ({
      grantId: grant.id,
      clientId: grant.client_id,
      clientName: grant.client_name,
      scope: grant.scope,
      createdAt: grant.created_at,
      lastUsedAt: grant.last_used_at,
    }));
    return NextResponse.json({ clients });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list MCP clients";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
