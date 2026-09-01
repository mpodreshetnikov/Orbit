import { describe, expect, it, vi } from "vitest";
import { runScheduledImport } from "./import-runner.js";
import { createBackfillStore } from "./backfill-store.js";
import {
  DEFAULT_BACKFILL_HORIZON_MONTHS,
  DEFAULT_INCREMENTAL_LOOKBACK_DAYS,
} from "./backfill-scheduler.js";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

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
    /** Connector debug summary per window, in the order the windows run. */
    debugPerWindow?: Array<Record<string, unknown> | undefined>;
    throwOnWindowIndex?: number;
    storage?: Record<string, unknown>;
  } = {},
) {
  const createdWindows: Array<{ from: unknown; to: unknown }> = [];
  const sessionTokensUsed: string[] = [];
  let windowIndex = 0;

  const connector = {
    sourceId: "tbank",
    parse: vi.fn().mockImplementation(async () => {
      const index = windowIndex;
      windowIndex += 1;
      if (options.throwOnWindowIndex === index) {
        throw new Error("history slice failed");
      }
      return {
        rows: [{ id: index }],
        windowTo: new Date(NOW).toISOString(),
        parsedThroughAt: new Date(NOW).toISOString(),
        parsedTransactionsCount: 1,
        debug: options.debugPerWindow?.[index],
      };
    }),
  };

  const callEdge = vi
    .fn()
    .mockImplementation(async (_url: string, token: string, payload: Record<string, unknown>) => {
      if (payload.action === "create_session") {
        createdWindows.push({ from: payload.window_from, to: payload.window_to });
        return {
          session_id: `session-${createdWindows.length}`,
          session_token: `session-token-${createdWindows.length}`,
          batch_id: `batch-${createdWindows.length}`,
          source: "tbank",
          payer_person_id: "person-1",
          // The edge function echoes the window back, as `createSessionAction` does.
          window_from: payload.window_from,
          window_to: payload.window_to,
        };
      }
      sessionTokensUsed.push(token);
      return { batch_id: "batch-x", inserted: 1, skipped: 0, error_count: 0 };
    });

  const memory = createMemoryStorage(options.storage);
  let session: Record<string, unknown> | null = null;

  return {
    connector,
    callEdge,
    createdWindows,
    sessionTokensUsed,
    memory,
    backfillStore: createBackfillStore(memory.storage),
    getSession: () => session,
    deps: {
      getConnector: () => connector as never,
      callEdge,
      broadcastToAppTabs: vi.fn().mockResolvedValue(undefined),
      nowIso: () => new Date(NOW).toISOString(),
      backfillStore: createBackfillStore(memory.storage),
      sessionStore: {
        async getSession() {
          return session;
        },
        async setSession(next: Record<string, unknown> | null) {
          session = next;
        },
      },
    },
  };
}

const SCOPE = { sourceId: "tbank", payerPersonId: "person-1" };

const INPUT = {
  sourceId: "tbank",
  payerPersonId: "person-1",
  nowMs: NOW,
  functionUrl: "https://project.supabase.co/functions/v1/money-import",
  credentials: { grantToken: "grant-token" },
  tabId: 42,
};

describe("runScheduledImport", () => {
  it("takes a catch-up window and one month-sized history slice", async () => {
    const harness = createHarness();
    const result = await runScheduledImport(INPUT, harness.deps);

    expect(harness.createdWindows).toHaveLength(2);
    const [incremental, backfill] = harness.createdWindows;
    expect(incremental.to).toBe(new Date(NOW).toISOString());
    expect(incremental.from).toBe(
      new Date(NOW - DEFAULT_INCREMENTAL_LOOKBACK_DAYS * DAY_MS).toISOString(),
    );
    // The history slice starts where the catch-up window begins and steps a month back.
    expect(backfill.to).toBe(incremental.from);
    expect(new Date(backfill.from as string).getTime()).toBeLessThan(
      new Date(backfill.to as string).getTime(),
    );
    expect(result.incremental).not.toBeNull();
    expect(result.backfill).not.toBeNull();
  });

  it("spends the grant only on create_session and works on session tokens after that", async () => {
    const harness = createHarness();
    await runScheduledImport(INPUT, harness.deps);

    const createCalls = harness.callEdge.mock.calls.filter(
      (call) => (call[2] as Record<string, unknown>).action === "create_session",
    );
    expect(createCalls.every((call) => call[1] === "grant-token")).toBe(true);
    // Everything after the session exists runs on the short-lived token it handed back, so a
    // leaked grant cannot be replayed against the rest of the conversation.
    expect(harness.sessionTokensUsed).not.toContain("grant-token");
    expect(harness.sessionTokensUsed.length).toBeGreaterThan(0);
  });

  it("gives each window its own session, because a completed one is not reusable", async () => {
    const harness = createHarness();
    await runScheduledImport(INPUT, harness.deps);

    const sessionIds = new Set(
      harness.callEdge.mock.calls
        .map((call) => (call[2] as Record<string, unknown>).session_id)
        .filter(Boolean),
    );
    expect(sessionIds.size).toBe(2);
  });

  it("moves the backfill cursor when the slice was read in full", async () => {
    const harness = createHarness();
    const planned = await runScheduledImport(INPUT, harness.deps);

    const state = await harness.backfillStore.getState({
      sourceId: "tbank",
      payerPersonId: "person-1",
    });
    expect(state.cursorMs).not.toBeNull();
    expect(new Date(planned.backfill?.window.windowFromIso ?? "").getTime()).toBe(state.cursorMs);
  });

  it("holds the cursor when the slice ran out of receipt budget", async () => {
    const harness = createHarness({
      debugPerWindow: [
        undefined,
        { receipt_enrichment: { skipped_after_budget_count: 12, stopped_after_budget: true } },
      ],
    });
    await runScheduledImport(INPUT, harness.deps);

    // The walk passes each slice once. Advancing past a slice whose receipts were left behind
    // would mean nothing ever collects them.
    const state = await harness.backfillStore.getState({
      sourceId: "tbank",
      payerPersonId: "person-1",
    });
    expect(state.cursorMs).toBeNull();
  });

  it("holds the cursor when the connector could not read the page", async () => {
    const harness = createHarness({
      debugPerWindow: [undefined, { blocked_reason: "login_required" }],
    });
    await runScheduledImport(INPUT, harness.deps);

    const state = await harness.backfillStore.getState({
      sourceId: "tbank",
      payerPersonId: "person-1",
    });
    expect(state.cursorMs).toBeNull();
  });

  it("keeps the catch-up window when the history slice throws", async () => {
    const harness = createHarness({ throwOnWindowIndex: 1 });
    const result = await runScheduledImport(INPUT, harness.deps);

    expect(result.incremental).not.toBeNull();
    expect(result.backfill).toBeNull();
    const state = await harness.backfillStore.getState({
      sourceId: "tbank",
      payerPersonId: "person-1",
    });
    expect(state.cursorMs).toBeNull();
  });

  it("lets a failed catch-up window fail the whole run", async () => {
    const harness = createHarness({ throwOnWindowIndex: 0 });
    await expect(runScheduledImport(INPUT, harness.deps)).rejects.toThrow("history slice failed");
  });

  it("stamps the backfill complete once the walk reaches its horizon", async () => {
    const horizonReachedMs = NOW - (DEFAULT_BACKFILL_HORIZON_MONTHS + 1) * 30 * DAY_MS;
    const harness = createHarness({
      storage: {
        money_import_backfill_state: {
          "tbank::person-1": {
            cursorMs: horizonReachedMs,
            horizonMonths: DEFAULT_BACKFILL_HORIZON_MONTHS,
            completedAtMs: null,
          },
        },
      },
    });
    const result = await runScheduledImport(INPUT, harness.deps);

    expect(result.backfill).toBeNull();
    expect(harness.createdWindows).toHaveLength(1);
    const state = await harness.backfillStore.getState({
      sourceId: "tbank",
      payerPersonId: "person-1",
    });
    expect(state.completedAtMs).toBe(NOW);
  });

  it("works in the tab it was given rather than whatever is in front of the person", async () => {
    const harness = createHarness();
    await runScheduledImport(INPUT, harness.deps);

    for (const call of harness.connector.parse.mock.calls) {
      expect((call[0] as { debug?: { tab_id?: number } }).debug?.tab_id).toBe(42);
    }
  });

  it("refuses to run without a credential", async () => {
    const harness = createHarness();
    await expect(runScheduledImport({ ...INPUT, credentials: {} }, harness.deps)).rejects.toThrow(
      "No credentials available for a scheduled import",
    );
  });

  it("tells the server a window failed instead of leaving its session running", async () => {
    const harness = createHarness({ throwOnWindowIndex: 1 });
    await runScheduledImport(INPUT, harness.deps);

    const completions = harness.callEdge.mock.calls
      .map((call) => call[2] as Record<string, unknown>)
      .filter((payload) => payload.action === "complete_session");
    // Nobody is watching an unattended run, so a session abandoned mid-window would sit as
    // "running" until its TTL and show in the import history as a run that never ended.
    expect(completions.some((payload) => payload.status === "failed")).toBe(true);
  });

  it("leaves a session the person started where it is", async () => {
    // One window only, so exactly one session is created and cleaned up.
    const horizonReachedMs = NOW - (DEFAULT_BACKFILL_HORIZON_MONTHS + 1) * 30 * DAY_MS;
    const harness = createHarness({
      storage: {
        money_import_backfill_state: {
          "tbank::person-1": {
            cursorMs: horizonReachedMs,
            horizonMonths: DEFAULT_BACKFILL_HORIZON_MONTHS,
            completedAtMs: null,
          },
        },
      },
    });

    // The app stores a session and reads it back a message later. A run clearing that field
    // between the two would fail the person's import for reasons on nobody's screen.
    const manualSession = { session_id: "manual-1" };
    harness.connector.parse.mockImplementation(async () => {
      await harness.deps.sessionStore.setSession(manualSession);
      return {
        rows: [{ id: 1 }],
        windowTo: new Date(NOW).toISOString(),
        parsedThroughAt: new Date(NOW).toISOString(),
        parsedTransactionsCount: 1,
      };
    });

    await runScheduledImport(INPUT, harness.deps);
    expect(harness.getSession()).toEqual(manualSession);
  });

  it("clears the session it opened when nobody else has claimed the field", async () => {
    const horizonReachedMs = NOW - (DEFAULT_BACKFILL_HORIZON_MONTHS + 1) * 30 * DAY_MS;
    const harness = createHarness({
      storage: {
        money_import_backfill_state: {
          "tbank::person-1": {
            cursorMs: horizonReachedMs,
            horizonMonths: DEFAULT_BACKFILL_HORIZON_MONTHS,
            completedAtMs: null,
          },
        },
      },
    });

    await runScheduledImport(INPUT, harness.deps);
    expect(harness.getSession()).toBeNull();
  });

  it("bounds the history slice at both ends", async () => {
    const harness = createHarness();
    await runScheduledImport(INPUT, harness.deps);

    // The connectors read `windowTo`; until they did, a slice planned as one month read from its
    // start through to today, so every run grew and re-imported everything newer.
    const backfillParse = harness.connector.parse.mock.calls[1]?.[0] as {
      windowFrom?: string;
      windowTo?: string;
    };
    expect(backfillParse.windowTo).toBeTruthy();
    expect(new Date(backfillParse.windowTo as string).getTime()).toBeLessThan(NOW);
    expect(new Date(backfillParse.windowFrom as string).getTime()).toBeLessThan(
      new Date(backfillParse.windowTo as string).getTime(),
    );
  });

  it("holds the cursor when a receipt was rate-limited rather than skipped for budget", async () => {
    const harness = createHarness({
      debugPerWindow: [
        undefined,
        { receipt_enrichment: { skipped_after_budget_count: 0, rate_limited_count: 2 } },
      ],
    });
    await runScheduledImport(INPUT, harness.deps);

    const state = await harness.backfillStore.getState(SCOPE);
    expect(state.cursorMs).toBeNull();
  });

  it("holds the cursor when the run stopped on its receipt budget", async () => {
    const harness = createHarness({
      debugPerWindow: [
        undefined,
        { receipt_enrichment: { skipped_after_budget_count: 0, stopped_after_budget: true } },
      ],
    });
    await runScheduledImport(INPUT, harness.deps);

    const state = await harness.backfillStore.getState(SCOPE);
    expect(state.cursorMs).toBeNull();
  });

  it("reports a failed history slice rather than passing it off as a finished walk", async () => {
    const harness = createHarness({ throwOnWindowIndex: 1 });
    const result = await runScheduledImport(INPUT, harness.deps);

    expect(result.backfill).toBeNull();
    expect(result.backfillError?.message).toContain("history slice failed");
    expect(result.backfillError?.window.windowFromIso).toBeTruthy();
  });

  it("keeps one person's walk out of another's", async () => {
    const harness = createHarness();
    await runScheduledImport(INPUT, harness.deps);
    const first = await harness.backfillStore.getState(SCOPE);
    expect(first.cursorMs).not.toBeNull();

    // A grant reissued for someone else at the same bank starts its own history, rather than
    // inheriting a cursor that would skip everything already walked for the first person.
    const second = await harness.backfillStore.getState({
      sourceId: "tbank",
      payerPersonId: "person-2",
    });
    expect(second.cursorMs).toBeNull();
    expect(second.completedAtMs).toBeNull();
  });

  it("reaches back to the last catch-up when runs have been paused", async () => {
    const pausedSinceMs = NOW - 30 * DAY_MS;
    const harness = createHarness({
      storage: {
        money_import_backfill_state: {
          "tbank::person-1": {
            cursorMs: NOW - 60 * DAY_MS,
            horizonMonths: DEFAULT_BACKFILL_HORIZON_MONTHS,
            completedAtMs: null,
            lastIncrementalToMs: pausedSinceMs,
          },
        },
      },
    });
    await runScheduledImport(INPUT, harness.deps);

    // Without this the catch-up would start three days ago and the month between would belong to
    // no window at all: the history walk only ever goes deeper than where it began.
    const incrementalFrom = new Date(harness.createdWindows[0].from as string).getTime();
    expect(incrementalFrom).toBeLessThan(pausedSinceMs);
  });

  it("refuses a window rather than overwriting a session the person just started", async () => {
    const harness = createHarness();
    // Stored after the sweep's opening check and before the run claims the field -- the case the
    // start-of-sweep snapshot cannot see.
    await harness.deps.sessionStore.setSession({ session_id: "manual-1" });

    await expect(runScheduledImport(INPUT, harness.deps)).rejects.toThrow(
      "A session started by the person is in progress",
    );
    expect(harness.getSession()).toEqual({ session_id: "manual-1" });

    const completions = harness.callEdge.mock.calls
      .map((call) => call[2] as Record<string, unknown>)
      .filter((payload) => payload.action === "complete_session");
    // The session it opened and could not use is closed, not left running.
    expect(completions.some((payload) => payload.status === "failed")).toBe(true);
  });

  it("marks its runs unattended so the app does not navigate on them", async () => {
    const harness = createHarness();
    await runScheduledImport(INPUT, harness.deps);

    const done = harness.deps.broadcastToAppTabs.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((message) => message.type === "MONEY_IMPORT_DONE");
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((message) => message.unattended === true)).toBe(true);
  });
});
