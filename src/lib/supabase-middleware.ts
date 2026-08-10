import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { getDevAuthBypassAutoLoginEmail } from "@/lib/dev-auth-bypass";

/**
 * Routes that authenticate themselves with a bearer token instead of the
 * Supabase session cookie. They must never be redirected to /login: the MCP
 * endpoint has to answer an unauthenticated call with a 401 challenge so the
 * client knows to start the OAuth flow, and the discovery documents have to be
 * readable by anyone. Skipping the session refresh also keeps them off the
 * auth round-trip on every request.
 *
 * `/oauth/authorize` is deliberately NOT listed: it is a browser page and
 * relies on the normal login + allowlist gate below.
 */
const BEARER_AUTH_ROUTE_PREFIXES = ["/api/mcp", "/api/oauth", "/.well-known"];

function isBearerAuthRoute(pathname: string) {
  return BEARER_AUTH_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Only same-origin, non-protocol-relative paths may be used as a post-login
 * destination, so a crafted `redirect` value cannot bounce the user off-site.
 */
function sanitizeRedirectTarget(target: string | null, fallback: string) {
  if (target && target.startsWith("/") && !target.startsWith("//")) {
    return target;
  }

  return fallback;
}

function redirectToDevLogin(request: NextRequest, nextPath: string) {
  const autoLoginEmail = getDevAuthBypassAutoLoginEmail();
  if (!autoLoginEmail) {
    return null;
  }

  const url = request.nextUrl.clone();
  url.pathname = "/auth/dev-login";
  // `clone()` carries over the incoming query string; drop it so the caller's
  // own parameters cannot collide with `email`/`next`.
  url.search = "";
  url.searchParams.set("email", autoLoginEmail);
  url.searchParams.set("next", nextPath);
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  if (isBearerAuthRoute(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Public routes that don't require auth
  const publicRoutes = ["/login", "/auth/callback", "/auth/dev-login", "/access-denied"];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  // If accessing a protected route
  if (!isPublicRoute) {
    // If not authenticated, redirect to login
    if (!user) {
      // Preserve the query string, not just the pathname. OAuth authorization
      // requests carry everything that matters (client_id, code_challenge,
      // state, ...) in the query, and dropping it would strand the caller on a
      // parameterless /oauth/authorize after login.
      const target = `${pathname}${request.nextUrl.search}`;

      const devLoginRedirect = redirectToDevLogin(request, target);
      if (devLoginRedirect) {
        return devLoginRedirect;
      }

      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("redirect", target);
      return NextResponse.redirect(url);
    }

    // Check if user is in allowlist (by auth_user_id OR email)
    const { data: allowedUser } = await supabase
      .from("allowed_users")
      .select("id")
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .single();

    // If not in allowlist, redirect to access denied
    if (!allowedUser) {
      const url = request.nextUrl.clone();
      url.pathname = "/access-denied";
      return NextResponse.redirect(url);
    }
  }

  if (pathname === "/login" && !user) {
    const redirectTo = sanitizeRedirectTarget(
      request.nextUrl.searchParams.get("redirect"),
      "/health",
    );
    const devLoginRedirect = redirectToDevLogin(request, redirectTo);
    if (devLoginRedirect) {
      return devLoginRedirect;
    }
  }

  // If authenticated and accessing login, redirect to app
  if (pathname === "/login" && user) {
    const { data: allowedUser } = await supabase
      .from("allowed_users")
      .select("id")
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .single();

    if (allowedUser) {
      // Honour an explicit destination so a user who lands back on /login
      // mid-flow (for example during OAuth consent) still reaches it.
      const target = sanitizeRedirectTarget(
        request.nextUrl.searchParams.get("redirect"),
        "/health",
      );
      const url = new URL(target, request.nextUrl.toString());
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
