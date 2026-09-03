import type { LocalStorageLike } from "./session-store.js";
import { isRunRequestLive, normalizeStaleAfterMs } from "./attention-policy.js";

const ATTENTION_STORAGE_KEY = "money_import_attention";

export interface AttentionState {
  staleAfterMs: number;
  /** When the extension last opened the attention page of its own accord. */
  lastOpenedAtMs: number | null;
  /** Runs a person asked for from the page, by source: when each was asked. */
  runRequests: Record<string, number>;
}

export interface AttentionStore {
  getState(): Promise<AttentionState>;
  /** Stores the threshold, bounded; returns what was stored. */
  setStaleAfterMs(value: unknown): Promise<number>;
  markPageOpened(nowMs: number): Promise<void>;
  requestRun(sourceId: string, nowMs: number): Promise<void>;
  isRunRequested(sourceId: string, nowMs: number): Promise<boolean>;
  clearRunRequest(sourceId: string): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readState(value: unknown): AttentionState {
  const record = asRecord(value);
  const requests: Record<string, number> = {};
  for (const [sourceId, at] of Object.entries(asRecord(record.runRequests))) {
    if (typeof at === "number" && Number.isFinite(at)) requests[sourceId] = at;
  }
  return {
    staleAfterMs: normalizeStaleAfterMs(record.staleAfterMs),
    lastOpenedAtMs:
      typeof record.lastOpenedAtMs === "number" && Number.isFinite(record.lastOpenedAtMs)
        ? record.lastOpenedAtMs
        : null,
    runRequests: requests,
  };
}

/** The settings and bookkeeping of the attention page, in `chrome.storage.local`. */
export function createAttentionStore(storage: LocalStorageLike): AttentionStore {
  async function read(): Promise<AttentionState> {
    const data = await storage.get([ATTENTION_STORAGE_KEY]);
    return readState(data[ATTENTION_STORAGE_KEY]);
  }

  async function write(state: AttentionState): Promise<void> {
    await storage.set({ [ATTENTION_STORAGE_KEY]: state });
  }

  return {
    getState: read,
    async setStaleAfterMs(value) {
      const state = await read();
      const staleAfterMs = normalizeStaleAfterMs(value);
      await write({ ...state, staleAfterMs });
      return staleAfterMs;
    },
    async markPageOpened(nowMs) {
      const state = await read();
      await write({ ...state, lastOpenedAtMs: nowMs });
    },
    async requestRun(sourceId, nowMs) {
      const state = await read();
      await write({ ...state, runRequests: { ...state.runRequests, [sourceId]: nowMs } });
    },
    async isRunRequested(sourceId, nowMs) {
      const state = await read();
      return isRunRequestLive(state.runRequests[sourceId], nowMs);
    },
    async clearRunRequest(sourceId) {
      const state = await read();
      if (!(sourceId in state.runRequests)) return;
      const { [sourceId]: _cleared, ...rest } = state.runRequests;
      await write({ ...state, runRequests: rest });
    },
  };
}
