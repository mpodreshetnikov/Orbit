import type { LocalStorageLike } from "./session-store.js";
import { createInitialBackfillState, type BackfillState } from "./backfill-scheduler.js";

const BACKFILL_STORAGE_KEY = "money_import_backfill_state";

export interface BackfillStore {
  getState(key: BackfillScope): Promise<BackfillState>;
  setState(key: BackfillScope, state: BackfillState): Promise<void>;
}

/**
 * A walk belongs to one person at one bank, not to the bank alone.
 *
 * Keying on the source alone meant a grant reissued for another family member inherited the
 * first person's cursor: a completed walk skipped their history entirely, and a half-finished
 * one started them in the middle of it.
 */
export interface BackfillScope {
  sourceId: string;
  payerPersonId: string;
}

function scopeKey(scope: BackfillScope): string {
  return `${scope.sourceId}::${scope.payerPersonId}`;
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
  const lastIncrementalToMs =
    typeof record.lastIncrementalToMs === "number" ? record.lastIncrementalToMs : null;
  return {
    ...createInitialBackfillState(horizonMonths),
    cursorMs,
    completedAtMs,
    lastIncrementalToMs,
  };
}

/**
 * Backfill state per person per source, kept under one storage key. Deleting that key restarts
 * every walk from the most recent month, which is the documented way to redo a history.
 */
export function createBackfillStore(storage: LocalStorageLike): BackfillStore {
  return {
    async getState(scope) {
      const data = await storage.get([BACKFILL_STORAGE_KEY]);
      const bySource = asRecord(data[BACKFILL_STORAGE_KEY]);
      return readState(bySource[scopeKey(scope)]) ?? createInitialBackfillState();
    },
    async setState(scope, state) {
      const data = await storage.get([BACKFILL_STORAGE_KEY]);
      const bySource = asRecord(data[BACKFILL_STORAGE_KEY]);
      await storage.set({
        [BACKFILL_STORAGE_KEY]: { ...bySource, [scopeKey(scope)]: state },
      });
    },
  };
}
