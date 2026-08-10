import { z } from "zod";
import {
  MAX_REDIRECT_URIS_PER_CLIENT,
  MCP_DEFAULT_SCOPE,
  isMcpServerEnabled,
} from "@/lib/mcp/config";
import { isAcceptableRedirectUri } from "@/lib/mcp/authorize-request";
import { registerClient } from "@/lib/mcp/oauth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function error(code: string, description: string, status = 400): Response {
  return json({ error: code, error_description: description }, status);
}

/**
 * RFC 7591 dynamic client registration.
 *
 * Deliberately unauthenticated -- that is what lets a user paste a URL into
 * Claude and have it register itself. The abuse surface is bounded instead:
 * `MCP_SERVER_ENABLED` gates the endpoint entirely, redirect URIs must be https
 * (or loopback), and `registerClient` enforces a hard cap on how many clients
 * can exist. A registered client can do nothing on its own; it still needs a
 * human to complete the Google login and approve consent.
 */
const registrationSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS_PER_CLIENT),
  client_name: z.string().max(200).optional(),
  scope: z.string().max(500).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  client_uri: z.string().optional(),
  logo_uri: z.string().optional(),
  policy_uri: z.string().optional(),
  tos_uri: z.string().optional(),
  software_id: z.string().optional(),
  software_version: z.string().optional(),
});

export async function POST(request: Request) {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return error("invalid_client_metadata", "Request body must be JSON.");
  }

  const parsed = registrationSchema.safeParse(payload);
  if (!parsed.success) {
    return error(
      "invalid_client_metadata",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }

  const { redirect_uris: redirectUris } = parsed.data;
  const rejected = redirectUris.filter((uri) => !isAcceptableRedirectUri(uri));
  if (rejected.length > 0) {
    return error(
      "invalid_redirect_uri",
      `Redirect URIs must be https (or http on loopback) and carry no fragment. Rejected: ${rejected.join(", ")}`,
    );
  }

  // Public clients only: they run in a browser or on a user's machine and
  // cannot hold a secret, so PKCE is what proves possession at token exchange.
  if (parsed.data.token_endpoint_auth_method && parsed.data.token_endpoint_auth_method !== "none") {
    return error(
      "invalid_client_metadata",
      "Only public clients are supported (token_endpoint_auth_method must be 'none').",
    );
  }

  try {
    const client = await registerClient({
      clientName: parsed.data.client_name ?? null,
      redirectUris,
      scope: parsed.data.scope?.trim() || MCP_DEFAULT_SCOPE,
      tokenEndpointAuthMethod: "none",
      grantTypes: parsed.data.grant_types ?? ["authorization_code", "refresh_token"],
      responseTypes: parsed.data.response_types ?? ["code"],
      clientUri: parsed.data.client_uri,
      logoUri: parsed.data.logo_uri,
      policyUri: parsed.data.policy_uri,
      tosUri: parsed.data.tos_uri,
      softwareId: parsed.data.software_id,
      softwareVersion: parsed.data.software_version,
    });

    return json(
      {
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: client.response_types,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        scope: client.scope,
        client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return error("invalid_client_metadata", message, 400);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
