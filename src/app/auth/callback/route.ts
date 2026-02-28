import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

const EMAIL_OTP_TYPES = new Set([
  "magiclink",
  "invite",
  "recovery",
  "signup",
  "email_change",
  "email",
] as const);

type EmailOtpType = "magiclink" | "invite" | "recovery" | "signup" | "email_change" | "email";

function sanitizeNextPath(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }

  return "/health";
}

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && EMAIL_OTP_TYPES.has(value as EmailOtpType);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"));

  const redirectUrl = new URL(next, request.url);

  if (code || (tokenHash && isEmailOtpType(type))) {
    // Create a response that we'll use to set cookies
    const response = NextResponse.redirect(redirectUrl);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    } else if (tokenHash && isEmailOtpType(type)) {
      await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
    }

    return response;
  }

  // No code, redirect to login
  return NextResponse.redirect(new URL("/login", request.url));
}
