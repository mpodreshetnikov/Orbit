import { createWhoIcdClient, type WhoTokenCache } from "./who-client.ts";

const WHO_ICD_CLIENT_ID = Deno.env.get("WHO_ICD_CLIENT_ID");
const WHO_ICD_CLIENT_SECRET = Deno.env.get("WHO_ICD_CLIENT_SECRET");

const tokenCache: WhoTokenCache = { current: null };

export function createDefaultIcdLookupDeps() {
  const whoClient = createWhoIcdClient({
    fetchFn: globalThis.fetch,
    clientId: WHO_ICD_CLIENT_ID,
    clientSecret: WHO_ICD_CLIENT_SECRET,
    cache: tokenCache,
    log: console,
  });

  return {
    whoClient,
  };
}

export type IcdLookupDeps = ReturnType<typeof createDefaultIcdLookupDeps>;
