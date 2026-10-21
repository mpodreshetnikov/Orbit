import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import { ExpoRoot, Stack } from "expo-router";
import { getMockContext } from "expo-router/testing-library";
import type { ComponentType } from "react";
import { SessionProvider } from "@/lib/session";

// Expo Router loads route modules lazily in an app; a test needs them there on the first render.
process.env.EXPO_ROUTER_IMPORT_MODE = "sync";

/**
 * Render screens inside a real Expo Router stack, with the app's session provider and a fresh query
 * cache.
 *
 * `routes` maps route files as `src/app` would hold them (`"today/index"`, `"medications/[id]/index"`)
 * to the screen components under test; navigation between them is the router's own, so a test that
 * taps a card lands on the pushed screen exactly as the app does. Retries are off so a failing
 * request shows its error state at once.
 *
 * Expo Router ships `renderRouter` for this, but it installs Jest's fake timers without letting time
 * advance and expects the synchronous `render` of Testing Library 13; this suite runs 14, whose
 * `render` is asynchronous, and controls its own clock.
 */
export async function renderScreens(routes: Record<string, ComponentType>, initialUrl: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  function Layout() {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider>
          <Stack />
        </SessionProvider>
      </QueryClientProvider>
    );
  }
  await render(
    <ExpoRoot context={getMockContext({ _layout: Layout, ...routes })} location={initialUrl} />,
  );
  return { client };
}
