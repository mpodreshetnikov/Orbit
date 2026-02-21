import { vi } from "vitest";

export function useFakeNow(now: string | Date): () => void {
  const date = typeof now === "string" ? new Date(now) : now;
  vi.useFakeTimers();
  vi.setSystemTime(date);
  return () => {
    vi.useRealTimers();
  };
}
