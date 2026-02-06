"use client";

import { Toaster } from "sonner";
import { useIsMobile } from "@/hooks/use-media-query";
import { PersonIdFromUrlSync } from "@/components/layout/person-id-from-url-sync";
import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

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
