import { isMcpServerEnabled } from "@/lib/mcp/config";
import { revokeGrantByToken } from "@/lib/mcp/oauth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

/**
 * RFC 7009 token revocation.
 *
 * The spec requires a 200 even for an unknown token: distinguishing "revoked"
 * from "never existed" would turn this into an oracle for probing valid tokens.
 */
export async function POST(request: Request) {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const body = await request.text();

  let token: string | null = null;
  if (contentType.includes("application/json")) {
    try {
      token = (JSON.parse(body) as { token?: string }).token ?? null;
    } catch {
      token = null;
    }
  } else {
    token = new URLSearchParams(body).get("token");
  }

  if (token) {
    await revokeGrantByToken(token);
  }

  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
