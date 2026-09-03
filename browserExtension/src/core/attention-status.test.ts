import { describe, expect, it } from "vitest";
import { buildAttentionStatus } from "./attention-status";
import { DAY_MS, HOUR_MS } from "./attention-policy";
import { createInitialAutoRunState, nextAutoRunState, type AutoRunState } from "./auto-run-policy";
import type { StoredImportGrant } from "./grant-store";

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
      attention: { staleAfterMs: DAY_MS, lastOpenedAtMs: null, runRequests: { alfa_web: NOW } },
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
      },
      {
        source_id: "alfa_web",
        last_ok_at: null,
        since: GRANT.received_at,
        stale: true,
        stale_for_ms: 3 * DAY_MS,
        run_requested: true,
      },
    ]);
  });

  it("reports nothing without a grant", async () => {
    const status = await buildAttentionStatus({
      grant: null,
      knownSources: ["tbank_web"],
      autoRunStore: autoRunStore({}),
      attention: { staleAfterMs: DAY_MS, lastOpenedAtMs: null, runRequests: {} },
      nowMs: NOW,
    });
    expect(status).toEqual({ stale_after_ms: DAY_MS, stale_count: 0, sources: [] });
  });
});
