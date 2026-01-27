"use client";

import { Toaster } from "sonner";
import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="app.theme"
    >
      <QueryProvider>
        {children}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          duration={5000}
        />
      </QueryProvider>
    </ThemeProvider>
  );
}
