import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  useFonts,
} from "@expo-google-fonts/geist";
import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/lib/queries";
import { InstanceProvider, useInstance } from "@/lib/instance-context";
import { SessionProvider } from "@/lib/session";
import { palettes } from "@/theme";

/**
 * The root layout.
 *
 * A native stack holds the sign-in screen and the tabs; each tab holds a native stack of its own, so
 * the back gesture, the large titles and the push animation are the system's rather than drawn in
 * JavaScript. The navigation theme carries the web app's palette, light and dark by the phone's
 * setting, so the system's own chrome — the tab bar, the headers — sits on the same colours as the
 * screens.
 */
export default function RootLayout() {
  const scheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  if (!fontsLoaded) {
    // A frame or two on a cold start; drawing before the face arrives would flash the system font.
    return null;
  }

  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const palette = scheme === "dark" ? palettes.dark : palettes.light;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.primary,
      background: palette.background,
      card: palette.background,
      text: palette.foreground,
      border: palette.border,
    },
  };

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <InstanceProvider>
          <InstanceSession>
            <ThemeProvider value={navigationTheme}>
              <StatusBar style={scheme === "dark" ? "light" : "dark"} />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="server" />
                <Stack.Screen name="sign-in" />
                <Stack.Screen name="(tabs)" />
              </Stack>
            </ThemeProvider>
          </InstanceSession>
        </InstanceProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** The session of the server in use: a new server starts a new session provider, signed out. */
function InstanceSession({ children }: { children: React.ReactNode }) {
  const { instance } = useInstance();
  if (instance === undefined) {
    // A frame on a cold start, while the phone's choice of server is read.
    return null;
  }
  return <SessionProvider key={instance?.address ?? "none"}>{children}</SessionProvider>;
}
