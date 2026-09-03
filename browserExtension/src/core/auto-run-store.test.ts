import { describe, expect, it } from "vitest";
import { createAutoRunStore } from "./auto-run-store";
import { createInitialAutoRunState } from "./auto-run-policy";

function createStorage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: async (keys: string[]) =>
      Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])),
    set: async (next: Record<string, unknown>) => {
      Object.assign(values, next);
    },
  };
}

describe("auto-run-store", () => {
  it("keeps attempt history per person per source", async () => {
    const store = createAutoRunStore(createStorage());
    const tbank = { sourceId: "tbank_web", payerPersonId: "person-1" };
    await store.setState(tbank, { lastRunAtMs: 10, lastResult: "ok", consecutiveFailures: 0 });

    expect(await store.getState(tbank)).toEqual({
      lastRunAtMs: 10,
      lastResult: "ok",
      consecutiveFailures: 0,
      lastError: null,
    });
    expect(await store.getState({ ...tbank, payerPersonId: "person-2" })).toEqual(
      createInitialAutoRunState(),
    );
  });

  it("keeps the last error's text, and reads states written before it existed", async () => {
    const storage = createStorage();
    const store = createAutoRunStore(storage);
    const scope = { sourceId: "tbank_web", payerPersonId: "person-1" };
    await store.setState(scope, {
      lastRunAtMs: 10,
      lastResult: "error",
      consecutiveFailures: 1,
      lastError: "T-Bank did not stay on the operations page",
    });
    expect((await store.getState(scope)).lastError).toBe(
      "T-Bank did not stay on the operations page",
    );

    storage.values.money_import_auto_state = {
      "tbank_web::person-1": { lastRunAtMs: 10, lastResult: "error", consecutiveFailures: 1 },
    };
    expect((await store.getState(scope)).lastError).toBeNull();
  });

  it("forgives the scopes that failed and leaves the ones that succeeded alone", async () => {
    const store = createAutoRunStore(createStorage());
    const failed = { sourceId: "tbank_web", payerPersonId: "person-1" };
    const fine = { sourceId: "alfa_web", payerPersonId: "person-1" };
    await store.setState(failed, { lastRunAtMs: 10, lastResult: "error", consecutiveFailures: 2 });
    await store.setState(fine, { lastRunAtMs: 20, lastResult: "ok", consecutiveFailures: 0 });

    expect(await store.forgiveFailures()).toBe(1);

    // Back to "never ran": the next visit may try again, whatever the backoff said.
    expect(await store.getState(failed)).toEqual(createInitialAutoRunState());
    // A run that worked keeps its cooldown; nothing about it needs another look.
    expect(await store.getState(fine)).toEqual({
      lastRunAtMs: 20,
      lastResult: "ok",
      consecutiveFailures: 0,
      lastError: null,
    });
  });

  it("changes nothing, and says so, when nothing failed", async () => {
    const storage = createStorage();
    const store = createAutoRunStore(storage);
    await store.setState(
      { sourceId: "tbank_web", payerPersonId: "person-1" },
      { lastRunAtMs: 10, lastResult: "ok", consecutiveFailures: 0 },
    );
    const before = JSON.stringify(storage.values);

    expect(await store.forgiveFailures()).toBe(0);
    expect(JSON.stringify(storage.values)).toBe(before);
  });
});
