import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

/**
 * Check if the current user is in the allowlist
 * Returns true if user is authenticated and allowed, false otherwise
 */
export async function isUserAllowed(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return false;
  }

  // Check if user is in allowlist (by auth_user_id OR email)
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .single();

  if (error || !data) {
    return false;
  }

  return true;
}

/**
 * Get the current authenticated user
 */
export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}
