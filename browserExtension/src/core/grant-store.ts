const GRANT_STORAGE_KEY = "extension_import_grant";

import type { LocalStorageLike } from "./session-store.js";

/**
 * The long-lived credential the app issued to this extension, as the extension holds it.
 *
 * The token is the whole secret: the server keeps only its SHA-256, so this copy is the only
 * usable one anywhere. It never leaves the extension except as a bearer token to `function_url`,
 * and that url is checked against the extension's own host permissions before it is stored --
 * the page that sends the grant is the app, but any script running on the app's page can post a
 * message, and a url taken on trust is a url a token gets sent to.
 */
export interface StoredImportGrant {
  token: string;
  person_id: string;
  allowed_sources: string[];
  function_url: string;
  app_origin: string;
  received_at: string;
}

export interface GrantStore {
  getGrant(): Promise<StoredImportGrant | null>;
  setGrant(grant: StoredImportGrant | null): Promise<void>;
}

export function createGrantStore(storage: LocalStorageLike): GrantStore {
  return {
    async getGrant() {
      const data = await storage.get([GRANT_STORAGE_KEY]);
      return (data[GRANT_STORAGE_KEY] as StoredImportGrant | undefined) ?? null;
    },
    async setGrant(grant) {
      await storage.set({ [GRANT_STORAGE_KEY]: grant });
    },
  };
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Whether this extension is allowed to talk to that url at all.
 *
 * Matched against the manifest's own `host_permissions`, which the build fills from
 * NEXT_PUBLIC_SUPABASE_URL. Anything outside them the browser would refuse anyway, so this is
 * the same boundary stated one step earlier -- before the token is written down rather than
 * after it is sent.
 */
export function isUrlWithinHostPermissions(url: string, hostPermissions: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  return hostPermissions.some((pattern) => {
    const match = /^(https?):\/\/([^/]+)\/(.*)$/.exec(pattern);
    if (!match) return false;
    const [, protocol, host] = match;
    if (`${protocol}:` !== parsed.protocol) return false;
    if (host.startsWith("*.")) return parsed.host.endsWith(host.slice(1));
    return host === parsed.host;
  });
}

/**
 * Reads a grant out of whatever the page sent, or returns null.
 *
 * Everything here is attacker-shaped until proven otherwise: the bridge listens on
 * `window.postMessage`, and any script on the app's page can post one.
 */
export function parseIncomingGrant(
  raw: unknown,
  hostPermissions: string[],
  nowIso: string,
): StoredImportGrant | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const token = trimmed(value.token);
  const personId = trimmed(value.person_id);
  const functionUrl = trimmed(value.function_url);
  const appOrigin = trimmed(value.app_origin);
  if (!token || !personId || !functionUrl) return null;
  if (!isUrlWithinHostPermissions(functionUrl, hostPermissions)) return null;

  const allowedSources = Array.isArray(value.allowed_sources)
    ? value.allowed_sources.map(trimmed).filter(Boolean)
    : [];
  if (allowedSources.length === 0) return null;

  return {
    token,
    person_id: personId,
    allowed_sources: allowedSources,
    function_url: functionUrl,
    app_origin: appOrigin,
    received_at: nowIso,
  };
}
