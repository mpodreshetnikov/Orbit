import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/lib/session";
import { theme } from "@/theme";

/**
 * The root layout.
 *
 * `Stack` is Expo Router's native stack, so the back gesture, the header and the push animation are
 * the system's own rather than drawn in JavaScript. That is most of what separates this from the web
 * view it replaces.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.color.background },
            headerTitleStyle: { color: theme.color.text },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.color.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ title: "Orbit" }} />
          <Stack.Screen name="today" options={{ title: "Сегодня" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
