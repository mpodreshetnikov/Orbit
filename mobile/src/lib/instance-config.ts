/** What the client needs in order to reach one Orbit instance. */
export type InstanceConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export class InstanceConfigError extends Error {}

/**
 * Validate the instance an Expo build was configured with.
 *
 * Separated from the `Constants` read in `@/lib/instance` so it can be tested without a React
 * Native runtime — importing `expo-constants` reaches `react-native`, whose Flow-typed entry point
 * no test runner here can parse — and
 * so `M7` has one function to call with an address the user typed instead of one baked into the
 * bundle. The rules here are the subset of `T-261017-5or`'s requirements that already apply to a
 * build-time value: https only, and a bare origin rather than a URL carrying a path.
 */
export function resolveInstanceConfig(extra: unknown): InstanceConfig {
  if (typeof extra !== "object" || extra === null) {
    throw new InstanceConfigError(
      "No Expo config was found. Run the app through `npx expo start` rather than importing it directly.",
    );
  }

  const { supabaseUrl, supabaseAnonKey } = extra as Record<string, unknown>;

  if (typeof supabaseUrl !== "string" || supabaseUrl === "") {
    throw new InstanceConfigError(
      "EXPO_PUBLIC_SUPABASE_URL is not set, so this build has no instance to talk to. See mobile/README.md.",
    );
  }
  if (typeof supabaseAnonKey !== "string" || supabaseAnonKey === "") {
    throw new InstanceConfigError(
      "EXPO_PUBLIC_SUPABASE_ANON_KEY is not set, so this build has no instance to talk to. See mobile/README.md.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new InstanceConfigError(`EXPO_PUBLIC_SUPABASE_URL is not a URL: ${supabaseUrl}`);
  }

  // Plain http would send the access token in clear text. Localhost is the one exception, because a
  // developer pointing the app at a local stack has no certificate to present.
  const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new InstanceConfigError(
      `EXPO_PUBLIC_SUPABASE_URL must be https (http is allowed only for localhost): ${supabaseUrl}`,
    );
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new InstanceConfigError(
      `EXPO_PUBLIC_SUPABASE_URL must be a bare origin with no path, query or fragment: ${supabaseUrl}`,
    );
  }

  return { supabaseUrl: parsed.origin, supabaseAnonKey };
}
