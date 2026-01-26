import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Public routes that don't require auth
  const publicRoutes = ["/login", "/auth/callback", "/access-denied"];
  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route)
  );

  // If accessing a protected route
  if (!isPublicRoute) {
    // If not authenticated, redirect to login
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
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

  // If authenticated and accessing login, redirect to app
  if (pathname === "/login" && user) {
    const { data: allowedUser } = await supabase
      .from("allowed_users")
      .select("id")
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .single();

    if (allowedUser) {
      const url = request.nextUrl.clone();
      url.pathname = "/health";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
