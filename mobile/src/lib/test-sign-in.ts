/**
 * The local test user a recordings bundle signs in as, or null in every other bundle.
 *
 * The iOS recordings lane (`.github/workflows/mobile-recordings.yml`, `T-261021-kr8`) runs this app
 * in a simulator against a throwaway local Supabase, where nobody can complete a Google sign-in. That
 * workflow, and only it, builds the bundle with these two variables set; Expo inlines an
 * `EXPO_PUBLIC_` value at bundle time, so a bundle built without them holds no such path at all. The
 * names are read literally because the inlining matches them literally.
 */
export function testSignInCredentials(): { email: string; password: string } | null {
  const email = process.env.EXPO_PUBLIC_TEST_SIGNIN_EMAIL;
  const password = process.env.EXPO_PUBLIC_TEST_SIGNIN_PASSWORD;
  return email && password ? { email, password } : null;
}
