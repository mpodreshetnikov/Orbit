/** What the client needs in order to reach one Orbit instance. */
export type InstanceConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

/** Why a typed address was refused, for the screen to say in the person's language. */
export type InstanceProblem =
  | "empty"
  | "invalid"
  | "notHttps"
  | "hasPath"
  | "unreachable"
  | "notOrbit"
  | "badConfig";

export class InstanceConfigError extends Error {
  constructor(
    message: string,
    readonly problem?: InstanceProblem,
  ) {
    super(message);
  }
}

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

  // Plain http would send the access token in clear text. Loopback is the one exception, and it is
  // narrower than it looks: it only helps a host that runs the bundle itself, such as
  // `expo start --web` or a simulator. On a phone `localhost` is the phone, so a local stack needs
  // an https tunnel rather than this exception — see mobile/README.md.
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

/**
 * The address a person typed for their instance, as the origin the app will ask: "orbit.example.com"
 * becomes "https://orbit.example.com". The same rules as a build-time address — https only, loopback
 * aside, and nothing but an origin — so a typed host cannot be talked to in clear text.
 */
export function normalizeAddress(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new InstanceConfigError("Enter the address of your Orbit server.", "empty");
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new InstanceConfigError(`Not an address: ${trimmed}`, "invalid");
  }
  const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new InstanceConfigError(`The address must be https: ${trimmed}`, "notHttps");
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new InstanceConfigError(
      `Enter only the server's address, without a path: ${trimmed}`,
      "hasPath",
    );
  }
  return parsed.origin;
}
