import React from "react";
import { buildErrorRedirectUrl, validateAuthorizeRequest } from "@/lib/mcp/authorize-request";
import {
  getOAuthSigningSecret,
  isMcpServerEnabled,
  MCP_SCOPE_READ,
  MCP_SCOPE_WRITE,
} from "@/lib/mcp/config";
import { createConsentToken } from "@/lib/mcp/crypto";
import { getClient } from "@/lib/mcp/oauth-store";
import { getCurrentUser } from "@/lib/supabase-server";
import { ConsentForm } from "@/components/oauth/consent-form";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The OAuth consent screen.
 *
 * This is a page rather than a route handler on purpose: it sits behind the
 * app's normal auth middleware, so an unauthenticated visitor is sent through
 * the existing Google login and allowlist check and lands back here with the
 * OAuth parameters intact. By the time this renders, the visitor is a
 * signed-in, allowlisted user.
 */

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [MCP_SCOPE_READ]:
    "View your health data: measurements, medical records, lab results, findings, diagnoses, checkups and medications.",
  [MCP_SCOPE_WRITE]:
    "Add and update health data: record measurements, edit catalog entries, and create or change medications.",
};

function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-destructive/40 bg-card p-6">
        <h1 className="text-xl font-semibold text-destructive">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isMcpServerEnabled()) {
    notFound();
  }

  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      params.set(key, value[0]);
    }
  }

  const clientId = params.get("client_id");
  const client = clientId ? await getClient(clientId) : null;
  const validation = validateAuthorizeRequest(params, client);

  if (validation.kind === "fatal") {
    // No trustworthy redirect target, so the error is shown here rather than
    // bounced onward. See authorize-request.ts for why this matters.
    return (
      <ErrorPanel title="This connection request is not valid" detail={validation.description} />
    );
  }

  if (validation.kind === "redirect") {
    redirect(
      buildErrorRedirectUrl(
        validation.redirectUri,
        validation.error,
        validation.description,
        validation.state,
      ),
    );
  }

  const user = await getCurrentUser();
  if (!user?.email) {
    // Should be unreachable: middleware gates this path. Belt and braces.
    return (
      <ErrorPanel
        title="You are not signed in"
        detail="Sign in to the app and then retry the connection from your MCP client."
      />
    );
  }

  const { request: authorizeRequest } = validation;

  // The form posts back to us; this HMAC is what stops a user editing the
  // hidden fields to approve a wider scope or a different client than they
  // were shown.
  const consentToken = createConsentToken(
    {
      clientId: authorizeRequest.clientId,
      redirectUri: authorizeRequest.redirectUri,
      scope: authorizeRequest.scope,
      state: authorizeRequest.state,
      codeChallenge: authorizeRequest.codeChallenge,
      resource: authorizeRequest.resource,
    },
    getOAuthSigningSecret(),
  );

  const scopes = authorizeRequest.scope
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => ({
      scope,
      description: SCOPE_DESCRIPTIONS[scope] ?? scope,
    }));

  return (
    <ConsentForm
      clientName={authorizeRequest.client.client_name || "An MCP client"}
      redirectHost={new URL(authorizeRequest.redirectUri).host}
      userEmail={user.email}
      scopes={scopes}
      clientId={authorizeRequest.clientId}
      redirectUri={authorizeRequest.redirectUri}
      scopeValue={authorizeRequest.scope}
      state={authorizeRequest.state}
      codeChallenge={authorizeRequest.codeChallenge}
      resource={authorizeRequest.resource}
      consentToken={consentToken}
    />
  );
}
