"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUIStore } from "@/stores/ui-store";

/**
 * Syncs personId from URL query into the UI store (e.g. when opening the app from a notification).
 * Removes the personId param from the URL after applying so the address bar stays clean.
 */
export function PersonIdFromUrlSync() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSelectedPersonId = useUIStore((state) => state.setSelectedPersonId);

  useEffect(() => {
    const personId = searchParams.get("personId");
    if (!personId || !personId.trim()) return;

    setSelectedPersonId(personId.trim());

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("personId");
    const search = nextParams.toString();
    const nextUrl = pathname + (search ? "?" + search : "");
    router.replace(nextUrl, { scroll: false });
  }, [pathname, searchParams, setSelectedPersonId, router]);

  return null;
}
