import type { LocalStorageLike } from "./session-store.js";
import { createInitialBackfillState, type BackfillState } from "./backfill-scheduler.js";

const BACKFILL_STORAGE_KEY = "money_import_backfill_state";

export interface BackfillStore {
  getState(sourceId: string): Promise<BackfillState>;
  setState(sourceId: string, state: BackfillState): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readState(value: unknown): BackfillState | null {
  const record = asRecord(value);
  if (!("cursorMs" in record) && !("horizonMonths" in record)) return null;
  const cursorMs = typeof record.cursorMs === "number" ? record.cursorMs : null;
  const horizonMonths = typeof record.horizonMonths === "number" ? record.horizonMonths : undefined;
  const completedAtMs = typeof record.completedAtMs === "number" ? record.completedAtMs : null;
  return { ...createInitialBackfillState(horizonMonths), cursorMs, completedAtMs };
}

/**
 * Per-source backfill state, kept under one storage key. Deleting that key restarts the walk
 * from the most recent month, which is the documented way to redo a history.
 */
export function createBackfillStore(storage: LocalStorageLike): BackfillStore {
  return {
    async getState(sourceId) {
      const data = await storage.get([BACKFILL_STORAGE_KEY]);
      const bySource = asRecord(data[BACKFILL_STORAGE_KEY]);
      return readState(bySource[sourceId]) ?? createInitialBackfillState();
    },
    async setState(sourceId, state) {
      const data = await storage.get([BACKFILL_STORAGE_KEY]);
      const bySource = asRecord(data[BACKFILL_STORAGE_KEY]);
      await storage.set({
        [BACKFILL_STORAGE_KEY]: { ...bySource, [sourceId]: state },
      });
    },
  };
}
