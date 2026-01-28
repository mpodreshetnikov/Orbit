"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { IcdLookupResult, IcdSearchResult } from "@/types";

/**
 * Hook to lookup ICD-10 code via the icd-lookup edge function.
 * Returns official names in both English and Russian.
 */
export function useIcdLookup(code: string | null) {
  return useQuery({
    queryKey: ["icd-lookup", code],
    queryFn: async (): Promise<IcdLookupResult> => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }
      
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/icd-lookup`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        }
      );
      
      if (!res.ok) {
        const error = await res.text();
        throw new Error(`ICD lookup failed: ${error}`);
      }
      
      return await res.json();
    },
    enabled: !!code && code.length >= 2,
    staleTime: Infinity, // ICD codes don't change
    gcTime: 1000 * 60 * 60 * 24, // Cache for 24 hours
  });
}

/**
 * Hook to search ICD-10 codes by term.
 * Returns matching codes with names in the specified language.
 */
export function useIcdSearch(query: string, lang: "en" | "ru" = "en") {
  return useQuery({
    queryKey: ["icd-search", query, lang],
    queryFn: async (): Promise<IcdSearchResult[]> => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }
      
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/icd-lookup`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ search: query, lang, maxResults: 15 }),
        }
      );
      
      if (!res.ok) {
        const error = await res.text();
        throw new Error(`ICD search failed: ${error}`);
      }
      
      const data = await res.json();
      return data.results || [];
    },
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Get ICD name for display. ICD-10 API supports English only for now.
 */
export function getLocalizedIcdName(
  result: IcdLookupResult | null | undefined,
  _locale?: string
): string | null {
  if (!result?.found) return null;
  return result.name_en;
}

/**
 * Get condition ICD name for display. ICD-10: English only.
 */
export function getConditionIcdName(
  icdNameEn: string | null | undefined,
  _icdNameRu?: string | null,
  _locale?: string
): string | null {
  return icdNameEn ?? null;
}
