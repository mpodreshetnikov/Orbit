import { isMcpServerEnabled } from "@/lib/mcp/config";
import {
  buildProtectedResourceMetadata,
  metadataJsonResponse,
  metadataPreflightResponse,
} from "@/lib/mcp/oauth-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Root form of the protected-resource document. Identical content to the
 * path-inserted variant under `/api/mcp`; both are served because clients
 * differ in which one they probe first.
 */
export async function GET(request: Request) {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  return metadataJsonResponse(buildProtectedResourceMetadata(request));
}

export async function OPTIONS() {
  return metadataPreflightResponse();
}
