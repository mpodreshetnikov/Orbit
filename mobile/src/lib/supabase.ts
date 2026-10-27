import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock, type SupabaseClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import type { Database } from "@db";
import { currentInstance } from "@/lib/instance";

let client: SupabaseClient<Database> | null = null;
let clientFor: string | null = null;

/**
 * The client for the instance in use, made the first time it is needed and again when the instance
 * changes.
 *
 * It holds the anon key and nothing else: every read and write is authorised by row-level security
 * against the signed-in user, exactly as in the web app. There is no service-role key here and no
 * server-side code — the property `T-261017-5or` needs, because a client that only ever speaks this
 * data API cannot be made to execute an instance's code, whichever address its user typed.
 *
 * The session is stored under a key per instance, so a second server never reads the first one's
 * tokens. `detectSessionInUrl` is off because there is no URL bar to read a session out of, and
 * `processLock` is what keeps two screens refreshing the token at once from racing. `pkce` is what
 * makes the Google sign-in safe to finish on a custom scheme: the redirect carries a code, not a
 * token, and only this app holds the verifier that turns it into a session.
 *
 * Session storage is `AsyncStorage` rather than `expo-secure-store`, deliberately for now: SecureStore
 * warns above 2048 bytes and a Supabase session exceeds that, so the documented way to use it is to
 * encrypt the session and keep only the key in SecureStore — required before `M6` puts a build on
 * anybody else's phone (`T-261018-l19`).
 */
function currentClient(): SupabaseClient<Database> {
  const instance = currentInstance();
  if (!instance) {
    throw new Error("No Orbit server has been chosen yet.");
  }
  const key = `${instance.supabaseUrl} ${instance.supabaseAnonKey}`;
  if (!client || clientFor !== key) {
    client = createClient<Database>(instance.supabaseUrl, instance.supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        storageKey: `orbit-auth-${new URL(instance.supabaseUrl).host}`,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        lock: processLock,
      },
    });
    clientFor = key;
  }
  return client;
}

/** The client of the instance in use; every screen imports this one name. */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, property) {
    const target = currentClient();
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
});

/**
 * Keep the token fresh while the app is in the foreground, and stop when it is not.
 *
 * Registered once, at module scope, because Supabase's own guidance is that it must be: a refresh
 * loop started per screen would multiply with every mount. Before a server is chosen there is nothing
 * to refresh.
 */
AppState.addEventListener("change", (state) => {
  if (!currentInstance()) return;
  if (state === "active") {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
