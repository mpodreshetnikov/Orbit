import { describe, expect, it } from "vitest";
import { createAttentionStore } from "./attention-store";
import { DAY_MS, DEFAULT_STALE_AFTER_MS, HOUR_MS, MIN_STALE_AFTER_MS } from "./attention-policy";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");

function createStorage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    async get(keys: string[]) {
      return Object.fromEntries(keys.map((key) => [key, values[key]]));
    },
    async set(next: Record<string, unknown>) {
      Object.assign(values, next);
    },
  };
}

describe("attention-store", () => {
  it("starts with the owner's default and bounds what is stored", async () => {
    const store = createAttentionStore(createStorage());
    expect(await store.getState()).toEqual({
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      lastOpenedAtMs: null,
      runRequests: {},
    });
    expect(await store.setStaleAfterMs(3 * DAY_MS)).toBe(3 * DAY_MS);
    expect(await store.setStaleAfterMs(-5)).toBe(MIN_STALE_AFTER_MS);
    expect((await store.getState()).staleAfterMs).toBe(MIN_STALE_AFTER_MS);
  });

  it("remembers when the page was opened", async () => {
    const store = createAttentionStore(createStorage());
    await store.markPageOpened(NOW);
    expect((await store.getState()).lastOpenedAtMs).toBe(NOW);
  });

  it("keeps a run request alive for an hour and clears it on demand", async () => {
    const store = createAttentionStore(createStorage());
    await store.requestRun("tbank_web", NOW);
    expect(await store.isRunRequested("tbank_web", NOW + 30 * 60 * 1000)).toBe(true);
    expect(await store.isRunRequested("alfa_web", NOW)).toBe(false);
    expect(await store.isRunRequested("tbank_web", NOW + 2 * HOUR_MS)).toBe(false);

    await store.clearRunRequest("tbank_web");
    expect(await store.isRunRequested("tbank_web", NOW)).toBe(false);
    expect((await store.getState()).runRequests).toEqual({});
  });

  it("reads a damaged record as the defaults", async () => {
    const storage = createStorage();
    storage.values.money_import_attention = {
      staleAfterMs: "soon",
      lastOpenedAtMs: "never",
      runRequests: { tbank_web: "now", alfa_web: NOW },
    };
    expect(await createAttentionStore(storage).getState()).toEqual({
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      lastOpenedAtMs: null,
      runRequests: { alfa_web: NOW },
    });
  });
});
