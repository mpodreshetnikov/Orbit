import { isMcpServerEnabled } from "@/lib/mcp/config";
import {
  buildProtectedResourceMetadata,
  metadataJsonResponse,
  metadataPreflightResponse,
} from "@/lib/mcp/oauth-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728), path-inserted form.
 *
 * This is the document the `WWW-Authenticate` challenge from `/api/mcp` points
 * at: for a resource at `/api/mcp`, the spec puts its metadata at
 * `/.well-known/oauth-protected-resource/api/mcp`. The root form is served too,
 * since clients differ in which they probe.
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
