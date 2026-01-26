"use client";

import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";

/**
 * Syncs language from localStorage to cookie on mount
 * This ensures SSR has the correct locale
 */
export function LanguageSync() {
  const language = useUIStore((state) => state.language);

  useEffect(() => {
    // Set cookie from store on mount
    if (typeof document !== "undefined") {
      document.cookie = `app.lang=${language};path=/;max-age=31536000`;
    }
  }, [language]);

  return null;
}
