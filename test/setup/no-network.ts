import { afterEach, beforeEach, vi } from "vitest";

function extractUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && "url" in input) {
    const value = (input as { url?: unknown }).url;
    if (typeof value === "string") return value;
  }
  return "<unknown>";
}

export function installNoNetworkGuard(): void {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    if (typeof globalThis.fetch !== "function") return;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
      const url = extractUrl(input);
      return Promise.reject(new Error(`Unexpected network call in unit test: ${url}`));
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
  });
}
