import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { revokeGrantOwnedByUser } from "@/lib/mcp/oauth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revokes one MCP connector grant owned by the signed-in user.
 *
 * After this returns, `verifyMcpBearerToken` sees `revoked_at` and the next
 * tool call on that bearer answers 401.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ grantId: string }> }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { grantId } = await context.params;
  if (!grantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const revoked = await revokeGrantOwnedByUser(grantId, user.id);
    if (!revoked) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke MCP client";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
