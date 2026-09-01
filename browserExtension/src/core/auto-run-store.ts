import type { LocalStorageLike } from "./session-store.js";
import { createInitialAutoRunState, type AutoRunState } from "./auto-run-policy.js";

const AUTO_RUN_STORAGE_KEY = "money_import_auto_state";

export interface AutoRunStore {
  getState(sourceId: string): Promise<AutoRunState>;
  setState(sourceId: string, state: AutoRunState): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readState(value: unknown): AutoRunState | null {
  const record = asRecord(value);
  if (!("lastRunAtMs" in record)) return null;
  return {
    lastRunAtMs: typeof record.lastRunAtMs === "number" ? record.lastRunAtMs : null,
    lastResult:
      record.lastResult === "ok" || record.lastResult === "error" ? record.lastResult : null,
    consecutiveFailures:
      typeof record.consecutiveFailures === "number" ? record.consecutiveFailures : 0,
  };
}

/** Per-source auto-run history, so one bank going quiet does not hold up another. */
export function createAutoRunStore(storage: LocalStorageLike): AutoRunStore {
  return {
    async getState(sourceId) {
      const data = await storage.get([AUTO_RUN_STORAGE_KEY]);
      const bySource = asRecord(data[AUTO_RUN_STORAGE_KEY]);
      return readState(bySource[sourceId]) ?? createInitialAutoRunState();
    },
    async setState(sourceId, state) {
      const data = await storage.get([AUTO_RUN_STORAGE_KEY]);
      const bySource = asRecord(data[AUTO_RUN_STORAGE_KEY]);
      await storage.set({ [AUTO_RUN_STORAGE_KEY]: { ...bySource, [sourceId]: state } });
    },
  };
}
