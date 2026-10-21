import * as Linking from "expo-linking";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { parseOAuthCallback } from "@/lib/oauth-callback";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { theme } from "@/theme";

/**
 * Sign in with Google, the way the web app does — it is the only way an Orbit instance lets anyone
 * in (`deploy/supabase.defaults.env` turns email sign-in off), and `public.allowed_users` decides who
 * gets past it.
 *
 * The round trip runs in the system's authentication sheet, which returns to this app on its own
 * scheme (`exp://` under Expo Go, `orbit://` in a build); both are on the instance's redirect
 * allowlist in `deploy/orbit`. The client is PKCE, so the redirect carries a code and the session is
 * minted here by exchanging it.
 */
export default function SignIn() {
  const { session } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    return <Redirect href="/today" />;
  }

  async function signInWithGoogle(): Promise<string | null> {
    const redirectTo = Linking.createURL("auth/callback");
    const { data, error: startError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (startError) {
      return startError.message;
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== "success") {
      // Closing the sheet is a choice, not a failure: say nothing and let them press again.
      return null;
    }
    const callback = parseOAuthCallback(result.url);
    if ("error" in callback) {
      return callback.error;
    }
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(callback.code);
    return exchangeError ? exchangeError.message : null;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const message = await signInWithGoogle();
    // On success the session listener redirects; the button stays busy rather than flashing back.
    if (message !== null || !(await supabase.auth.getSession()).data.session) {
      setError(message);
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.button,
            busy && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.color.background} />
          ) : (
            <Text style={styles.buttonLabel}>Войти через Google</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", backgroundColor: theme.color.background },
  form: { padding: theme.space.lg, gap: theme.space.md },
  error: { color: theme.color.danger, fontSize: 15 },
  button: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.space.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { color: theme.color.background, fontSize: 17, fontWeight: "600" },
});
