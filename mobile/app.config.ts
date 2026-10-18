import type { ExpoConfig } from "expo/config";

/**
 * The instance this build talks to.
 *
 * Read from the environment at bundle time, which is why `M7` of `T-261018-l19` exists: a communal
 * app has to ask its user for this instead, and that is a run-time question. Until then a build is
 * tied to one instance, and the two names below are the only place that is true.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Shared with the Capacitor shell of `T-0024` on purpose: it is the same product, and that shell is
 * not shipping. Two applications cannot hold one identifier, so reusing it keeps the identity of
 * "Orbit on iOS" in one place rather than minting a second one for the client that replaces it.
 */
const BUNDLE_IDENTIFIER = "com.podreshetnikov.orbit";

const config: ExpoConfig = {
  name: "Orbit",
  slug: "orbit",
  scheme: "orbit",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  // Light only, declared honestly. `automatic` would let a dark-mode phone pick light status
  // bar content, and every background in `src/theme.ts` is still white — white on white. A
  // dark palette is worth having and worth seeing on a device before it ships.
  userInterfaceStyle: "light",
  plugins: ["expo-router"],
  experiments: {
    typedRoutes: true,
  },
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    supportsTablet: false,
  },
  extra: {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  },
};

export default config;
