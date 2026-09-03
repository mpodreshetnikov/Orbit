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

/**
 * The settings and bookkeeping of the attention page, in `chrome.storage.local`.
 *
 * Every change is a read of the whole record, a change, and a write of the whole record, and
 * the background script handles messages concurrently -- two Updates pressed for two banks
 * would each read the record without the other's request and the later write would drop it.
 * Changes run one at a time.
 */
export function createAttentionStore(storage: LocalStorageLike): AttentionStore {
  let chain: Promise<unknown> = Promise.resolve();

  function change<T>(mutate: (state: AttentionState) => Promise<T> | T): Promise<T> {
    const next = chain.then(async () => {
      const state = await read();
      return await mutate(state);
    });
    chain = next.catch(() => undefined);
    return next;
  }

  async function read(): Promise<AttentionState> {
    const data = await storage.get([ATTENTION_STORAGE_KEY]);
    return readState(data[ATTENTION_STORAGE_KEY]);
  }

  async function write(state: AttentionState): Promise<void> {
    await storage.set({ [ATTENTION_STORAGE_KEY]: state });
  }

  return {
    getState: read,
    setStaleAfterMs(value) {
      return change(async (state) => {
        const staleAfterMs = normalizeStaleAfterMs(value);
        await write({ ...state, staleAfterMs });
        return staleAfterMs;
      });
    },
    markPageOpened(nowMs) {
      return change((state) => write({ ...state, lastOpenedAtMs: nowMs }));
    },
    requestRun(sourceId, nowMs) {
      return change((state) =>
        write({ ...state, runRequests: { ...state.runRequests, [sourceId]: nowMs } }),
      );
    },
    async isRunRequested(sourceId, nowMs) {
      const state = await read();
      return isRunRequestLive(state.runRequests[sourceId], nowMs);
    },
    clearRunRequest(sourceId) {
      return change(async (state) => {
        if (!(sourceId in state.runRequests)) return;
        const { [sourceId]: _cleared, ...rest } = state.runRequests;
        await write({ ...state, runRequests: rest });
      });
    },
  };
}
