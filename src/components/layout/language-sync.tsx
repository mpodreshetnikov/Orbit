"use client";

import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";

const SW_LOCALE_CACHE_NAME = "app-prefs";
const SW_LOCALE_CACHE_KEY = "/app-locale";

/**
 * Syncs language from localStorage to cookie on mount.
 * Also writes locale to Cache API so the service worker can read it for notification i18n.
 */
export function LanguageSync() {
  const language = useUIStore((state) => state.language);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.cookie = `app.lang=${language};path=/;max-age=31536000`;
    if ("caches" in window) {
      caches.open(SW_LOCALE_CACHE_NAME).then((cache) => {
        cache.put(SW_LOCALE_CACHE_KEY, new Response(language));
      });
    }
  }, [language]);

  return null;
}
