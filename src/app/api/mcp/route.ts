import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { PROTECTED_RESOURCE_METADATA_PATH, isMcpServerEnabled } from "@/lib/mcp/config";
import { registerHealthTools } from "@/lib/mcp/tools";
import { verifyMcpBearerToken } from "@/lib/mcp/verify-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The MCP endpoint. Add this URL as a custom connector in an MCP client
 * (Claude on web, desktop, mobile, or Claude Code) and it will discover the
 * OAuth server, register itself, walk the user through the app's normal Google
 * login, and then call these tools on their behalf.
 *
 * Auth is bearer-token only. An unauthenticated call must answer 401 with a
 * `WWW-Authenticate` header naming the protected-resource document -- that
 * header is how a client discovers where to authenticate. The app's session
 * middleware skips this path precisely so it cannot turn that 401 into a
 * redirect to /login (see BEARER_AUTH_ROUTE_PREFIXES in supabase-middleware.ts).
 */
const handler = createMcpHandler(
  (server) => {
    registerHealthTools(server);
  },
  {
    serverInfo: { name: "orbit-health", version: "1.0.0" },
    instructions: [
      "Health data for a personal/family health app.",
      "Most tools are scoped to a person (family members and pets are tracked separately).",
      "Call list_persons first when you do not know which person a request refers to, and ask the user rather than guessing.",
      "Two different things are called measurements here: `measurements` are manually recorded body metrics (weight, height, circumferences), while observations are lab values extracted from uploaded medical documents. Pick the right one for the question.",
    ].join(" "),
  },
);

const authenticatedHandler = withMcpAuth(handler, verifyMcpBearerToken, {
  required: true,
  resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
});

async function route(request: Request): Promise<Response> {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }
  return authenticatedHandler(request);
}

export { route as GET, route as POST, route as DELETE };
