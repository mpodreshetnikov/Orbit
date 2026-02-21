const SESSION_STORAGE_KEY = "extension_import_session";

export interface LocalStorageLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export interface SessionStore {
  getSession(): Promise<Record<string, unknown> | null>;
  setSession(session: Record<string, unknown> | null): Promise<void>;
}

export function createSessionStore(storage: LocalStorageLike): SessionStore {
  return {
    async getSession() {
      const data = await storage.get([SESSION_STORAGE_KEY]);
      return (data[SESSION_STORAGE_KEY] as Record<string, unknown> | undefined) ?? null;
    },
    async setSession(session) {
      await storage.set({ [SESSION_STORAGE_KEY]: session });
    },
  };
}
