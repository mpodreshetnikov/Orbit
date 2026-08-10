import { isMcpServerEnabled } from "@/lib/mcp/config";
import {
  buildAuthorizationServerMetadata,
  metadataJsonResponse,
  metadataPreflightResponse,
} from "@/lib/mcp/oauth-metadata";

export const runtime = "nodejs";
// Must never be statically rendered: the document embeds the request origin.
export const dynamic = "force-dynamic";

/** OAuth 2.0 Authorization Server Metadata (RFC 8414). */
export async function GET(request: Request) {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  return metadataJsonResponse(buildAuthorizationServerMetadata(request));
}

export async function OPTIONS() {
  return metadataPreflightResponse();
}
