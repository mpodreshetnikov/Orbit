import { describe, expect, it } from "vitest";
import { buildAttentionStatus } from "./attention-status";
import { DAY_MS, HOUR_MS } from "./attention-policy";
import {
  createInitialAutoRunState,
  DEFAULT_AUTO_RUN_COOLDOWN_MS,
  nextAutoRunState,
  withFailedAttempt,
  type AutoRunState,
} from "./auto-run-policy";
import type { StoredImportGrant } from "./grant-store";
import { createRunBoard } from "./run-board";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");

const GRANT: StoredImportGrant = {
  token: "grant-token",
  person_id: "person-1",
  allowed_sources: ["tbank_web", "alfa_web", "unknown_web"],
  function_url: "https://project.supabase.co/functions/v1/money-import",
  app_origin: "https://app.example.com",
  received_at: new Date(NOW - 3 * DAY_MS).toISOString(),
};

function autoRunStore(states: Record<string, AutoRunState>) {
  return {
    getState: async (scope: { sourceId: string; payerPersonId: string }) =>
      states[`${scope.sourceId}::${scope.payerPersonId}`] ?? createInitialAutoRunState(),
    setState: async () => {},
    forgiveFailures: async () => 0,
  };
}

describe("buildAttentionStatus", () => {
  it("reports each covered source the extension can reach, and counts the stale ones", async () => {
    const status = await buildAttentionStatus({
      grant: GRANT,
      knownSources: ["tbank_web", "alfa_web"],
      autoRunStore: autoRunStore({
        // Fresh: succeeded two hours ago.
        "tbank_web::person-1": nextAutoRunState(null, NOW - 2 * HOUR_MS, "ok"),
        // Never succeeded: counted from the grant's arrival, three days ago.
      }),
      attention: {
        staleAfterMs: DAY_MS,
        lastOpenedAtMs: null,
        lastStartedAtMs: null,
        runRequests: { "alfa_web::person-1": NOW },
        requestTabs: {},
      },
      nowMs: NOW,
    });

    expect(status.stale_after_ms).toBe(DAY_MS);
    expect(status.stale_count).toBe(1);
    expect(status.sources).toEqual([
      {
        source_id: "tbank_web",
        last_ok_at: new Date(NOW - 2 * HOUR_MS).toISOString(),
        since: new Date(NOW - 2 * HOUR_MS).toISOString(),
        stale: false,
        stale_for_ms: 2 * HOUR_MS,
        run_requested: false,
        live_run: null,
        last_attempt: {
          at: new Date(NOW - 2 * HOUR_MS).toISOString(),
          result: "ok",
          error: null,
          origin: "auto",
        },
        next_run: {
          kind: "after",
          at: new Date(NOW - 2 * HOUR_MS + DEFAULT_AUTO_RUN_COOLDOWN_MS).toISOString(),
        },
      },
      {
        source_id: "alfa_web",
        last_ok_at: null,
        since: GRANT.received_at,
        stale: true,
        stale_for_ms: 3 * DAY_MS,
        run_requested: true,
        live_run: null,
        last_attempt: null,
        next_run: { kind: "now" },
      },
    ]);
  });

  it("reports the run in flight for a source, and what the last attempt said", async () => {
    const liveRuns = createRunBoard({ now: () => NOW });
    liveRuns.start({
      session_id: "session-1",
      source_id: "tbank_web",
      payer_person_id: "person-1",
      origin: "requested",
      window_kind: "incremental",
      window_from: new Date(NOW - 3 * DAY_MS).toISOString(),
      window_to: new Date(NOW).toISOString(),
      tab_id: 77,
    });
    liveRuns.observe("session-1", {
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_enriching_operations",
      progress_percent: 35,
      parsed_transactions_count: 8,
      estimated_remaining_ms: 40_000,
    });
    // Another person's run at Alfa is not this key's.
    liveRuns.start({
      session_id: "session-2",
      source_id: "alfa_web",
      payer_person_id: "person-2",
      origin: "auto",
      window_kind: "backfill",
      window_from: null,
      window_to: null,
      tab_id: null,
    });

    const status = await buildAttentionStatus({
      grant: GRANT,
      knownSources: ["tbank_web", "alfa_web"],
      autoRunStore: autoRunStore({
        "tbank_web::person-1": nextAutoRunState(
          nextAutoRunState(null, NOW - 2 * DAY_MS, "ok"),
          NOW - DAY_MS,
          "error",
          "T-Bank did not stay on the operations page",
        ),
      }),
      attention: {
        staleAfterMs: DAY_MS,
        lastOpenedAtMs: null,
        lastStartedAtMs: null,
        runRequests: {},
        requestTabs: {},
      },
      nowMs: NOW,
      liveRuns,
    });

    expect(status.sources[0]).toMatchObject({
      source_id: "tbank_web",
      live_run: {
        origin: "requested",
        window_kind: "incremental",
        window_from: new Date(NOW - 3 * DAY_MS).toISOString(),
        window_to: new Date(NOW).toISOString(),
        started_at: new Date(NOW).toISOString(),
        running: true,
        phase: "parse_enriching_operations",
        progress_percent: 35,
        parsed_transactions_count: 8,
        batch_id: null,
        error: null,
      },
      last_attempt: {
        at: new Date(NOW - DAY_MS).toISOString(),
        result: "error",
        error: "T-Bank did not stay on the operations page",
        origin: "auto",
      },
    });
    // The projection carries no tab id and no estimate: those are the widget's, not the page's.
    expect(status.sources[0].live_run).not.toHaveProperty("tab_id");
    expect(status.sources[0].live_run).not.toHaveProperty("estimated_remaining_ms");
    expect(status.sources[1]).toMatchObject({ source_id: "alfa_web", live_run: null });
  });

  it("does not call a finished run in progress, and shows a failed manual run as the last attempt", async () => {
    const liveRuns = createRunBoard({ now: () => NOW });
    liveRuns.start({
      session_id: "session-1",
      source_id: "tbank_web",
      payer_person_id: "person-1",
      origin: "auto",
      window_kind: "incremental",
      window_from: null,
      window_to: null,
      tab_id: null,
    });
    // Done, and not yet taken off the board by the runner's cleanup.
    liveRuns.observe("session-1", { type: "MONEY_IMPORT_DONE", batch_id: "batch-1" });

    const status = await buildAttentionStatus({
      grant: GRANT,
      knownSources: ["tbank_web"],
      autoRunStore: autoRunStore({
        // An automatic success, then a manual run that failed: the failure is the last attempt.
        "tbank_web::person-1": withFailedAttempt(
          nextAutoRunState(null, NOW - 2 * HOUR_MS, "ok"),
          NOW - HOUR_MS,
          "still signed out",
          "manual",
        ),
      }),
      attention: {
        staleAfterMs: DAY_MS,
        lastOpenedAtMs: null,
        lastStartedAtMs: null,
        runRequests: {},
      },
      nowMs: NOW,
      liveRuns,
    });

    expect(status.sources[0]).toMatchObject({
      live_run: null,
      last_attempt: {
        at: new Date(NOW - HOUR_MS).toISOString(),
        result: "error",
        error: "still signed out",
        origin: "manual",
      },
    });
  });

  it("reports nothing without a grant", async () => {
    const status = await buildAttentionStatus({
      grant: null,
      knownSources: ["tbank_web"],
      autoRunStore: autoRunStore({}),
      attention: {
        staleAfterMs: DAY_MS,
        lastOpenedAtMs: null,
        lastStartedAtMs: null,
        runRequests: {},
        requestTabs: {},
      },
      nowMs: NOW,
    });
    expect(status).toEqual({ stale_after_ms: DAY_MS, stale_count: 0, sources: [] });
  });
});
