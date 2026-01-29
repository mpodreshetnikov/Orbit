"use client";

import { useState, useEffect } from "react";

/**
 * Matches Tailwind's md breakpoint (768px).
 * Use to adapt UI for mobile vs desktop (e.g. PWA vs desktop).
 */
const MEDIA_QUERY_MD = "(min-width: 768px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

/** True when viewport is at least md (768px), i.e. desktop. */
export function useIsDesktop(): boolean {
  return useMediaQuery(MEDIA_QUERY_MD);
}

/** True when viewport is below md, i.e. mobile/PWA. */
export function useIsMobile(): boolean {
  return !useMediaQuery(MEDIA_QUERY_MD);
}
