"use client";

import type { Locale } from "date-fns";
import { enUS, ru } from "date-fns/locale";
import { useUIStore } from "@/stores/ui-store";
import type { Language } from "@/stores/ui-store";

/**
 * Returns date-fns locale for the given app language (for weekday/month names in UI).
 */
export function getDateFnsLocale(lang: Language): Locale {
  return lang === "ru" ? ru : enUS;
}

/**
 * Returns BCP 47 locale string for Intl (toLocaleString, toLocaleDateString, etc.).
 */
export function getIntlLocale(lang: Language): string {
  return lang === "ru" ? "ru-RU" : "en-US";
}

/**
 * Format string for short date with weekday (e.g. day selector header).
 * Russian: "EE, d MMM" (Пн, 6 янв.); English: "EEE, MMM d".
 */
export function getDateHeaderFormat(lang: Language): string {
  return lang === "ru" ? "EEEEEE, d MMM" : "EEE, MMM d";
}

/** Hook: date-fns locale for current UI language. */
export function useDateFnsLocale(): Locale {
  const language = useUIStore((s) => s.language);
  return getDateFnsLocale(language);
}

/** Hook: Intl locale string for current UI language. */
export function useIntlLocale(): string {
  const language = useUIStore((s) => s.language);
  return getIntlLocale(language);
}

/** Hook: date header format string for current UI language (EE, d MMM for ru; EEE, MMM d for en). */
export function useDateHeaderFormat(): string {
  const language = useUIStore((s) => s.language);
  return getDateHeaderFormat(language);
}
