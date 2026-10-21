import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock } from "@supabase/supabase-js";
import { AppState } from "react-native";
import type { Database } from "@db";
import { instanceConfig } from "@/lib/instance";

const { supabaseUrl, supabaseAnonKey } = instanceConfig();

/**
 * The client this app reaches its instance through.
 *
 * It holds the anon key and nothing else: every read and write is authorised by row-level security
 * against the signed-in user, exactly as in the web app. There is no service-role key here and no
 * server-side code — which is also the property `T-261017-5or` needs, because a client that only
 * ever speaks this data API cannot be made to execute an instance's code.
 *
 * `detectSessionInUrl` is off because there is no URL bar to read a session out of, and `processLock`
 * is what keeps two screens refreshing the token at once from racing. `pkce` is what makes the Google
 * sign-in safe to finish on a custom scheme: the redirect carries a code, not a token, and only this
 * app holds the verifier that turns it into a session.
 *
 * Session storage is `AsyncStorage` rather than `expo-secure-store`, which looks like the weaker
 * choice and is a deliberate one for now: SecureStore warns above 2048 bytes and a Supabase session
 * exceeds that, so the documented way to use it is to encrypt the session and keep only the key in
 * SecureStore. That is worth doing and it is not worth doing blind — see `T-261018-l19`, where it is
 * required before `M6` puts a build on anybody else's phone. Until then this app runs through Expo
 * Go on the owner's own device.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce",
    lock: processLock,
  },
});

/**
 * Keep the token fresh while the app is in the foreground, and stop when it is not.
 *
 * Registered once, at module scope, because Supabase's own guidance is that it must be: a refresh
 * loop started per screen would multiply with every mount.
 */
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
