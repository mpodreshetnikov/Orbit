import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/database";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isDevAuthBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS_ENABLED === "1";
}

function sanitizeNextPath(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }

  return "/health";
}

function toLoginRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/login", request.url));
}

function isAlreadyRegisteredError(message: string): boolean {
  return (
    message.includes("already") && (message.includes("registered") || message.includes("exists"))
  );
}

export async function GET(request: NextRequest) {
  if (!isDevAuthBypassEnabled()) {
    return toLoginRedirect(request);
  }

  const requestUrl = new URL(request.url);
  const rawEmail = requestUrl.searchParams.get("email") ?? "";
  const email = rawEmail.trim().toLowerCase();
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get("next"));

  if (!EMAIL_REGEX.test(email)) {
    return toLoginRedirect(request);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return toLoginRedirect(request);
  }

  const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (createUserError) {
    const message = createUserError.message.toLowerCase();
    if (!isAlreadyRegisteredError(message)) {
      return toLoginRedirect(request);
    }
  }

  const { error: allowlistError } = await adminClient
    .from("allowed_users")
    .upsert({ email }, { onConflict: "email" });

  if (allowlistError) {
    return toLoginRedirect(request);
  }

  const callbackUrl = new URL("/auth/callback", request.url);
  callbackUrl.searchParams.set("next", nextPath);

  const { data: linkData, error: generateLinkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: callbackUrl.toString(),
    },
  });

  const tokenHash = linkData?.properties?.hashed_token;
  if (generateLinkError || !tokenHash) {
    return toLoginRedirect(request);
  }

  callbackUrl.searchParams.set("token_hash", tokenHash);
  callbackUrl.searchParams.set("type", "magiclink");
  return NextResponse.redirect(callbackUrl);
}
