import { describe, expect, it } from "vitest";
import { createRunBoard } from "./run-board";

const NOW = Date.parse("2026-09-07T15:00:00.000Z");

function board() {
  return createRunBoard({ now: () => NOW });
}

describe("createRunBoard", () => {
  it("records a run as it starts and reads the broadcasts that follow into it", () => {
    const runs = board();
    runs.start({
      session_id: "session-1",
      source_id: "tbank_web",
      payer_person_id: "person-1",
      origin: "auto",
      window_kind: "incremental",
      window_from: "2026-09-04T00:00:00.000Z",
      window_to: "2026-09-07T15:00:00.000Z",
      tab_id: 77,
    });

    runs.observe("session-1", {
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_enriching_operations",
      progress_percent: 40,
      parsed_transactions_count: 12,
      estimated_remaining_ms: 90_000,
      estimate_updated_at: "2026-09-07T15:01:00.000Z",
    });

    expect(runs.get("session-1")).toEqual({
      session_id: "session-1",
      source_id: "tbank_web",
      payer_person_id: "person-1",
      origin: "auto",
      window_kind: "incremental",
      window_from: "2026-09-04T00:00:00.000Z",
      window_to: "2026-09-07T15:00:00.000Z",
      tab_id: 77,
      started_at: "2026-09-07T15:00:00.000Z",
      running: true,
      phase: "parse_enriching_operations",
      progress_percent: 40,
      parsed_transactions_count: 12,
      estimated_total_ms: null,
      estimated_remaining_ms: 90_000,
      estimated_receipt_request_count: null,
      estimate_updated_at: "2026-09-07T15:01:00.000Z",
      batch_id: null,
      error: null,
    });
    expect(runs.findBySource("tbank_web", "person-1")?.session_id).toBe("session-1");
    // Another person's key finds nothing here; a caller naming no person finds the run.
    expect(runs.findBySource("tbank_web", "person-2")).toBeNull();
    expect(runs.findBySource("tbank_web")?.session_id).toBe("session-1");
    expect(runs.findBySource("alfa_web")).toBeNull();
  });

  it("keeps what a later broadcast leaves out, and ends the run on done or error", () => {
    const runs = board();
    runs.start({
      session_id: "session-1",
      source_id: "tbank_web",
      payer_person_id: "person-1",
      origin: "requested",
      window_kind: "backfill",
      window_from: null,
      window_to: null,
      tab_id: null,
      batch_id: "batch-1",
    });
    runs.observe("session-1", {
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_completed",
      progress_percent: 60,
    });
    runs.observe("session-1", { type: "MONEY_IMPORT_PROGRESS", parsed_transactions_count: 3 });
    expect(runs.get("session-1")).toMatchObject({
      phase: "parse_completed",
      progress_percent: 60,
      parsed_transactions_count: 3,
      batch_id: "batch-1",
      running: true,
    });

    runs.observe("session-1", {
      type: "MONEY_IMPORT_DONE",
      phase: "review_ready",
      progress_percent: 100,
      batch_id: "batch-2",
    });
    expect(runs.get("session-1")).toMatchObject({
      running: false,
      batch_id: "batch-2",
      progress_percent: 100,
    });

    runs.observe("session-1", { type: "MONEY_IMPORT_ERROR", error: "bank signed out" });
    expect(runs.get("session-1")).toMatchObject({ running: false, error: "bank signed out" });

    runs.end("session-1");
    expect(runs.get("session-1")).toBeNull();
    expect(runs.list()).toEqual([]);
  });

  it("records a run it never saw start from its broadcasts alone", () => {
    const runs = board();
    const run = runs.observe("session-9", {
      type: "MONEY_IMPORT_PROGRESS",
      phase: "starting",
      progress_percent: 2,
    });
    expect(run).toMatchObject({
      session_id: "session-9",
      source_id: null,
      origin: "manual",
      window_kind: "manual",
      running: true,
      phase: "starting",
      progress_percent: 2,
    });
    // A caller's own word on `running` wins over what the type implies.
    expect(
      runs.observe("session-9", { type: "MONEY_IMPORT_PROGRESS", running: false }).running,
    ).toBe(false);
  });
});
