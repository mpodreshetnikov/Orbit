import type { LocalStorageLike } from "./session-store.js";

const GRANT_STORAGE_KEY = "money_import_grant";

export interface MoneyImportGrantCredential {
  token: string;
  personId: string;
  allowedSources: string[];
  appOrigin: string | null;
  functionUrl: string | null;
}

export interface GrantStore {
  getGrant(): Promise<MoneyImportGrantCredential | null>;
  setGrant(grant: MoneyImportGrantCredential | null): Promise<void>;
}

function readGrant(value: unknown): MoneyImportGrantCredential | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const token = typeof record.token === "string" ? record.token.trim() : "";
  const personId = typeof record.personId === "string" ? record.personId.trim() : "";
  if (!token || !personId) return null;
  return {
    token,
    personId,
    allowedSources: Array.isArray(record.allowedSources)
      ? record.allowedSources.filter((entry): entry is string => typeof entry === "string")
      : [],
    appOrigin: typeof record.appOrigin === "string" ? record.appOrigin : null,
    functionUrl: typeof record.functionUrl === "string" ? record.functionUrl : null,
  };
}

/**
 * Holds the credential that lets the extension start an import unattended.
 *
 * Deleting this key is the documented way back to the old behaviour: with no grant the
 * extension only ever runs when the app hands it a session.
 */
export function createGrantStore(storage: LocalStorageLike): GrantStore {
  return {
    async getGrant() {
      const data = await storage.get([GRANT_STORAGE_KEY]);
      return readGrant(data[GRANT_STORAGE_KEY]);
    },
    async setGrant(grant) {
      await storage.set({ [GRANT_STORAGE_KEY]: grant });
    },
  };
}
