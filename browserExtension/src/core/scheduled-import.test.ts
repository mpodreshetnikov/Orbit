import { describe, expect, it, vi } from "vitest";
import { runScheduledImport } from "./import-runner.js";
import { createBackfillStore } from "./backfill-store.js";
import { createInitialBackfillState } from "./backfill-scheduler.js";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

function createMemoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    storage: {
      async get(keys: string[]) {
        const result: Record<string, unknown> = {};
        for (const key of keys) result[key] = data[key];
        return result;
      },
      async set(values: Record<string, unknown>) {
        Object.assign(data, values);
      },
    },
  };
}

function createHarness(
  options: {
    /** Per-window connector outcome, in the order the windows run. */
    results?: Array<Record<string, unknown>>;
    backfillThrows?: boolean;
  } = {},
) {
  const sessions: Array<Record<string, unknown>> = [];
  const createdWindows: Array<{ from: unknown; to: unknown }> = [];
  const results = options.results ?? [];
  let windowIndex = 0;

  const connector = {
    sourceId: "tbank_web",
    parse: vi.fn().mockImplementation(async () => {
      const current = results[windowIndex] ?? {};
      if (options.backfillThrows && windowIndex === 1) {
        windowIndex += 1;
        throw new Error("history slice failed");
      }
      windowIndex += 1;
      return {
        rows: [{ id: windowIndex }],
        windowTo: "2026-08-23T12:00:00.000Z",
        parsedThroughAt: "2026-08-20T12:00:00.000Z",
        parsedTransactionsCount: 1,
        debug: current,
      };
    }),
  };

  const callEdge = vi
    .fn()
    .mockImplementation(async (_url: string, _token: string, payload: Record<string, unknown>) => {
      if (payload.action === "create_session") {
        createdWindows.push({ from: payload.window_from, to: payload.window_to });
        return {
          session_id: `session-${createdWindows.length}`,
          session_token: `token-${createdWindows.length}`,
          batch_id: `batch-${createdWindows.length}`,
          source: "tbank_web",
          payer_person_id: "person-1",
        };
      }
      if (payload.action === "preview_rows") {
        return { batch_id: "batch-x", inserted: 1, skipped: 0, error_count: 0 };
      }
      return { ok: true };
    });

  const memory = createMemoryStorage();

  return {
    connector,
    callEdge,
    createdWindows,
    sessions,
    memory,
    deps: {
      getConnector: () => connector as never,
      callEdge,
      broadcastToAppTabs: vi.fn().mockResolvedValue(undefined),
      nowIso: () => new Date(NOW).toISOString(),
      backfillStore: createBackfillStore(memory.storage),
      sessionStore: {
        async getSession() {
          return sessions[sessions.length - 1] ?? null;
        },
        async setSession(session: Record<string, unknown> | null) {
          if (session) sessions.push(session);
        },
      },
    },
  };
}

const input = {
  sourceId: "tbank_web",
  payerPersonId: "person-1",
  nowMs: NOW,
  functionUrl: "https://example.com/fn",
  credentials: { grantToken: "grant-token" },
};

describe("runScheduledImport", () => {
  it("runs the catch-up window and one history slice, each on its own session", async () => {
    const harness = createHarness({
      results: [{ partial_result: false }, { partial_result: false }],
    });

    const result = await runScheduledImport(input, harness.deps);

    expect(harness.createdWindows).toEqual([
      { from: "2026-08-20T12:00:00.000Z", to: "2026-08-23T12:00:00.000Z" },
      { from: "2026-07-20T12:00:00.000Z", to: "2026-08-20T12:00:00.000Z" },
    ]);
    expect(result.incremental?.window.windowFromIso).toBe("2026-08-20T12:00:00.000Z");
    expect(result.backfill?.window.windowFromIso).toBe("2026-07-20T12:00:00.000Z");
    // A session per window: runImportSession revokes the one it is given, so a second
    // window sharing it would be rejected on its first request.
    expect(harness.sessions.map((session) => session.session_id)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("walks a month deeper on the next run", async () => {
    const harness = createHarness({
      results: [{ partial_result: false }, { partial_result: false }],
    });
    await runScheduledImport(input, harness.deps);

    const next = createHarness({ results: [{ partial_result: false }, { partial_result: false }] });
    next.deps.backfillStore = harness.deps.backfillStore;
    await runScheduledImport(input, next.deps);

    expect(next.createdWindows[1]).toEqual({
      from: "2026-06-20T12:00:00.000Z",
      to: "2026-07-20T12:00:00.000Z",
    });
  });

  it("repeats the same slice while receipts are still owed", async () => {
    const harness = createHarness({
      results: [
        { partial_result: false },
        { partial_result: false, receipt_enrichment: { skipped_after_budget_count: 7 } },
      ],
    });
    await runScheduledImport(input, harness.deps);

    const next = createHarness({ results: [{ partial_result: false }, { partial_result: false }] });
    next.deps.backfillStore = harness.deps.backfillStore;
    await runScheduledImport(input, next.deps);

    expect(next.createdWindows[1]).toEqual({
      from: "2026-07-20T12:00:00.000Z",
      to: "2026-08-20T12:00:00.000Z",
    });
  });

  it("repeats a slice the connector could not read in full", async () => {
    const harness = createHarness({
      results: [{ partial_result: false }, { partial_result: true }],
    });
    await runScheduledImport(input, harness.deps);

    const state = await harness.deps.backfillStore.getState("tbank_web");
    expect(state).toEqual(createInitialBackfillState());
  });

  it("keeps the catch-up window even when the history slice fails", async () => {
    const harness = createHarness({
      results: [{ partial_result: false }, {}],
      backfillThrows: true,
    });

    const result = await runScheduledImport(input, harness.deps);

    expect(result.incremental).not.toBeNull();
    expect(result.backfill).toBeNull();
    const state = await harness.deps.backfillStore.getState("tbank_web");
    expect(state.cursorMs).toBeNull();
  });
});
