"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Loader2, ShieldCheck } from "lucide-react";

export interface ConsentScope {
  scope: string;
  description: string;
}

export interface ConsentFormProps {
  clientName: string;
  redirectHost: string;
  userEmail: string;
  scopes: ConsentScope[];
  clientId: string;
  redirectUri: string;
  scopeValue: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
  consentToken: string;
}

/**
 * Consent screen for an MCP client requesting access to the Health tools.
 *
 * Submits as a plain form POST so the flow keeps working without JavaScript and
 * so the browser follows the resulting redirect back to the client. The hidden
 * fields are covered by `consentToken`, an HMAC the server re-derives, so
 * editing them in devtools invalidates the submission rather than escalating
 * the grant.
 */
export function ConsentForm({
  clientName,
  redirectHost,
  userEmail,
  scopes,
  clientId,
  redirectUri,
  scopeValue,
  state,
  codeChallenge,
  resource,
  consentToken,
}: ConsentFormProps) {
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
  const submittedRef = useRef(false);

  // The buttons must stay enabled while the submission is in flight. Disabling
  // the clicked button re-renders it as `disabled` before the browser runs the
  // form's activation behaviour, and a disabled submit button does not submit
  // its form -- the spinner would appear and no request would ever be sent.
  // Double submits are blocked here instead, where the first submission has
  // already been dispatched.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (submittedRef.current) {
      event.preventDefault();
      return;
    }
    submittedRef.current = true;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-medium">Connection request</span>
          </div>
          <CardTitle className="text-2xl">Connect {clientName}?</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">{clientName}</span> wants to access your
            health data. You are signed in as{" "}
            <span className="font-medium text-foreground">{userEmail}</span>.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium">This will allow it to:</p>
            <ul className="space-y-2">
              {scopes.map(({ scope, description }) => (
                <li key={scope} className="flex gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{description}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            After approving you will be returned to{" "}
            <span className="font-medium text-foreground">{redirectHost}</span>. You can disconnect
            at any time from Settings.
          </p>

          <form
            method="POST"
            action="/api/oauth/authorize/decision"
            className="space-y-3"
            onSubmit={handleSubmit}
            aria-busy={submitting !== null}
          >
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="scope" value={scopeValue} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            <input type="hidden" name="consent_token" value={consentToken} />
            {state !== null && <input type="hidden" name="state" value={state} />}
            {resource !== null && <input type="hidden" name="resource" value={resource} />}

            <Button
              type="submit"
              name="decision"
              value="approve"
              className="w-full"
              aria-disabled={submitting !== null}
              onClick={() => setSubmitting("approve")}
            >
              {submitting === "approve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve
            </Button>
            <Button
              type="submit"
              name="decision"
              value="deny"
              variant="outline"
              className="w-full"
              aria-disabled={submitting !== null}
              onClick={() => setSubmitting("deny")}
            >
              {submitting === "deny" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deny
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
