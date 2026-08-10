import { NextResponse } from "next/server";
import { buildErrorRedirectUrl, buildSuccessRedirectUrl } from "@/lib/mcp/authorize-request";
import { getOAuthSigningSecret, isMcpServerEnabled } from "@/lib/mcp/config";
import { verifyConsentToken } from "@/lib/mcp/crypto";
import { createAuthorizationCode, getClient } from "@/lib/mcp/oauth-store";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receives the consent form submission and, on approval, mints the
 * authorization code the client will exchange for tokens.
 *
 * Two independent checks gate this:
 *  1. The Supabase session cookie must identify a signed-in user -- the code is
 *     bound to *that* user, never to whatever the form claims.
 *  2. The consent token must verify against the posted parameters, proving the
 *     user approved these exact values and not edited ones.
 */
export async function POST(request: Request) {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  const form = await request.formData();
  const field = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };

  const clientId = field("client_id");
  const redirectUri = field("redirect_uri");
  const scope = field("scope");
  const codeChallenge = field("code_challenge");
  const consentToken = field("consent_token");
  const state = field("state");
  const resource = field("resource");
  const decision = field("decision");

  if (!clientId || !redirectUri || !scope || !codeChallenge || !consentToken) {
    return new Response("Malformed consent submission.", { status: 400 });
  }

  // Re-validate the client and the redirect target from storage rather than
  // trusting the form, so a tampered redirect_uri cannot leak a code.
  const client = await getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return new Response("This connection request is no longer valid.", { status: 400 });
  }

  const consentValid = verifyConsentToken(
    consentToken,
    { clientId, redirectUri, scope, state, codeChallenge, resource },
    getOAuthSigningSecret(),
  );
  if (!consentValid) {
    return new Response(
      "This consent request has expired or was modified. Start the connection again.",
      { status: 400 },
    );
  }

  if (decision !== "approve") {
    return NextResponse.redirect(
      buildErrorRedirectUrl(redirectUri, "access_denied", "The user denied the request.", state),
      { status: 303 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return new Response("You are not signed in. Sign in and start the connection again.", {
      status: 401,
    });
  }

  const code = await createAuthorizationCode({
    clientId,
    authUserId: user.id,
    userEmail: user.email,
    redirectUri,
    scope,
    codeChallenge,
    resource,
  });

  // 303 so the browser follows with GET after the form POST.
  return NextResponse.redirect(buildSuccessRedirectUrl(redirectUri, code, state), { status: 303 });
}
