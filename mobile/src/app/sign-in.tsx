import { Redirect } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { theme } from "@/theme";

/**
 * Sign in with the same credentials as the web app.
 *
 * Email and password only: the web app's other entry points assume a browser, and an OAuth round
 * trip needs the deep-link handling that `scheme` exists for but nothing yet uses.
 */
export default function SignIn() {
  const { session } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    return <Redirect href="/today" />;
  }

  const canSubmit = email.trim() !== "" && password !== "" && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      // Supabase deliberately says "Invalid login credentials" without saying which half was wrong;
      // passing its message through keeps that property rather than guessing a friendlier one.
      setError(signInError.message);
      setBusy(false);
      return;
    }
    // On success the session listener redirects; leaving `busy` set avoids a flash of the form.
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Почта"
          placeholderTextColor={theme.color.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          returnKeyType="next"
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Пароль"
          placeholderTextColor={theme.color.textMuted}
          autoCapitalize="none"
          autoComplete="current-password"
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={() => {
            if (canSubmit) {
              void submit();
            }
          }}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.button,
            !canSubmit && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.color.background} />
          ) : (
            <Text style={styles.buttonLabel}>Войти</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", backgroundColor: theme.color.background },
  form: { padding: theme.space.lg, gap: theme.space.md },
  input: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    fontSize: 17,
    color: theme.color.text,
  },
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
