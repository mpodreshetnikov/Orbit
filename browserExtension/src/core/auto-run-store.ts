import type { LocalStorageLike } from "./session-store.js";
import { createInitialAutoRunState, type AutoRunState } from "./auto-run-policy.js";

const AUTO_RUN_STORAGE_KEY = "money_import_auto_state";

export interface AutoRunStore {
  getState(scope: AutoRunScope): Promise<AutoRunState>;
  setState(scope: AutoRunScope, state: AutoRunState): Promise<void>;
  /**
   * Drops every scope whose last attempt failed, so the next visit may try again. Returns how
   * many were dropped. A scope whose last run succeeded keeps its cooldown: nothing about it
   * needs another look.
   */
  forgiveFailures(): Promise<number>;
}

/**
 * Attempt history belongs to one person at one bank.
 *
 * Keyed on the source alone, a grant reissued after the old one had failed its three attempts
 * handed the new credential the old one's despair: `shouldAutoRun` refused every unattended run
 * for a working grant, and only a manual import could clear it.
 */
export interface AutoRunScope {
  sourceId: string;
  payerPersonId: string;
}

function scopeKey(scope: AutoRunScope): string {
  return `${scope.sourceId}::${scope.payerPersonId}`;
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
    lastError: typeof record.lastError === "string" ? record.lastError : null,
  };
}

/**
 * Auto-run history per person per source, so one going quiet does not hold up another.
 *
 * Failures are forgiven when the extension is updated. The backoff exists for a bank the
 * person has signed out of; it cannot tell that apart from a connector that was broken, and
 * after the connector is fixed it kept the fixed one silent for the rest of the day -- the
 * person installed the new version, opened their bank, and nothing happened.
 */
export function createAutoRunStore(storage: LocalStorageLike): AutoRunStore {
  return {
    async getState(scope) {
      const data = await storage.get([AUTO_RUN_STORAGE_KEY]);
      const bySource = asRecord(data[AUTO_RUN_STORAGE_KEY]);
      return readState(bySource[scopeKey(scope)]) ?? createInitialAutoRunState();
    },
    async setState(scope, state) {
      const data = await storage.get([AUTO_RUN_STORAGE_KEY]);
      const bySource = asRecord(data[AUTO_RUN_STORAGE_KEY]);
      await storage.set({ [AUTO_RUN_STORAGE_KEY]: { ...bySource, [scopeKey(scope)]: state } });
    },
    async forgiveFailures() {
      const data = await storage.get([AUTO_RUN_STORAGE_KEY]);
      const bySource = asRecord(data[AUTO_RUN_STORAGE_KEY]);
      const kept: Record<string, unknown> = {};
      let forgiven = 0;
      for (const [key, value] of Object.entries(bySource)) {
        if (readState(value)?.lastResult === "error") {
          forgiven += 1;
          continue;
        }
        kept[key] = value;
      }
      if (forgiven > 0) await storage.set({ [AUTO_RUN_STORAGE_KEY]: kept });
      return forgiven;
    },
  };
}
