"use client";

import { useEffect, useMemo } from "react";
import { Toaster } from "sonner";
import { useIsMobile } from "@/hooks/use-media-query";
import { PersonIdFromUrlSync } from "@/components/layout/person-id-from-url-sync";
import { createClientTelemetryLogger } from "@/lib/observability/client-logger";
import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const telemetry = useMemo(
    () =>
      createClientTelemetryLogger({
        app: "web",
        component: "providers",
      }),
    [],
  );

  useEffect(() => {
    telemetry.info("web_providers_initialized", {
      is_mobile: isMobile,
    });
  }, [telemetry, isMobile]);

  useEffect(() => {
    telemetry.info("web_app_session_started", {
      initial_path: window.location.pathname,
    });

    return () => {
      telemetry.info("web_app_session_ended", {
        final_visibility: document.visibilityState,
      });
    };
  }, [telemetry]);

  useEffect(() => {
    const onVisibilityChange = () => {
      telemetry.debug("web_app_visibility_changed", {
        visibility_state: document.visibilityState,
      });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [telemetry]);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="app.theme"
    >
      <QueryProvider>
        <PersonIdFromUrlSync />
        {children}
        <Toaster
          position={isMobile ? "top-center" : "bottom-right"}
          richColors
          closeButton
          duration={5000}
        />
      </QueryProvider>
    </ThemeProvider>
  );
}
