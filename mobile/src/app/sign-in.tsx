import * as Linking from "expo-linking";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { Button, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { parseOAuthCallback } from "@/lib/oauth-callback";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space, usePalette } from "@/theme";

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
  const palette = usePalette();
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
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: space.xl,
        gap: space.xl,
        backgroundColor: palette.background,
      }}
    >
      <View style={{ gap: space.xs }}>
        <Text size="xl" weight="semibold">
          {t("auth.welcome")}
        </Text>
        <Text size="sm" tone="mutedForeground">
          {t("auth.subtitle")}
        </Text>
      </View>
      {error ? (
        <Text size="sm" tone="destructive">
          {error}
        </Text>
      ) : null}
      <Button label={t("auth.signInWithGoogle")} busy={busy} onPress={() => void submit()} />
    </View>
  );
}
