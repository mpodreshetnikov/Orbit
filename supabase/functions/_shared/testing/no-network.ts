import { toUrlString } from "./fetch-stub.ts";

/**
 * Reject all network calls and restore the original fetch on cleanup.
 */
export function installNoNetworkGuard(messagePrefix = "Unexpected network call in unit test"): {
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.reject(new Error(`${messagePrefix}: ${toUrlString(input)}`))) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}
