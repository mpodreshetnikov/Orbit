import { describe, expect, it } from "vitest";
import { createAttentionStore } from "./attention-store";
import { DAY_MS, DEFAULT_STALE_AFTER_MS, HOUR_MS, MIN_STALE_AFTER_MS } from "./attention-policy";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const TBANK = { sourceId: "tbank_web", payerPersonId: "person-1" };
const ALFA = { sourceId: "alfa_web", payerPersonId: "person-1" };

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
      lastStartedAtMs: null,
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
    await store.markBrowserStarted(NOW + 1);
    expect((await store.getState()).lastStartedAtMs).toBe(NOW + 1);
  });

  it("keeps a run request alive for an hour and clears it on demand", async () => {
    const store = createAttentionStore(createStorage());
    await store.requestRun(TBANK, NOW);
    expect(await store.isRunRequested(TBANK, NOW + 30 * 60 * 1000)).toBe(true);
    expect(await store.isRunRequested(ALFA, NOW)).toBe(false);
    expect(await store.isRunRequested(TBANK, NOW + 2 * HOUR_MS)).toBe(false);

    await store.clearRunRequest(TBANK);
    expect(await store.isRunRequested(TBANK, NOW)).toBe(false);
    expect((await store.getState()).runRequests).toEqual({});
  });

  it("reads a damaged record as the defaults", async () => {
    const storage = createStorage();
    storage.values.money_import_attention = {
      staleAfterMs: "soon",
      lastOpenedAtMs: "never",
      runRequests: { "tbank_web::person-1": "now", "alfa_web::person-1": NOW },
    };
    expect(await createAttentionStore(storage).getState()).toEqual({
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      lastOpenedAtMs: null,
      lastStartedAtMs: null,
      runRequests: { "alfa_web::person-1": NOW },
    });
  });
});

describe("attention-store under concurrent changes", () => {
  it("keeps both of two requests made at the same moment", async () => {
    const store = createAttentionStore(createStorage());
    await Promise.all([store.requestRun(TBANK, NOW), store.requestRun(ALFA, NOW + 1)]);
    expect((await store.getState()).runRequests).toEqual({
      "tbank_web::person-1": NOW,
      "alfa_web::person-1": NOW + 1,
    });

    await Promise.all([store.clearRunRequest(TBANK), store.setStaleAfterMs(2 * DAY_MS)]);
    expect(await store.getState()).toEqual({
      staleAfterMs: 2 * DAY_MS,
      lastOpenedAtMs: null,
      lastStartedAtMs: null,
      runRequests: { "alfa_web::person-1": NOW + 1 },
    });
  });
});

describe("attention-store per person", () => {
  it("does not hand one person's request to another at the same bank", async () => {
    const store = createAttentionStore(createStorage());
    await store.requestRun(TBANK, NOW);
    expect(await store.isRunRequested({ ...TBANK, payerPersonId: "person-2" }, NOW)).toBe(false);
  });
});
