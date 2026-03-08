import { describe, expect, it } from "vitest";
import { createImportDebugStore } from "./import-debug.js";

describe("import-debug store", () => {
  it("tracks one run with ordered events and finish state", () => {
    const store = createImportDebugStore();
    const run = store.startRun({
      debug_run_id: "dbg-1",
      session_id: "session-1",
      batch_id: "batch-1",
      source: "tbank_web",
      tab_id: 22,
      window_from: "2026-03-01T00:00:00.000Z",
    });

    store.append("dbg-1", { event: "session_loaded", attrs: { has_session_id: true } });
    store.append("dbg-1", { event: "parse_started", attrs: { tab_id: 22 } });
    store.finish("dbg-1", "ok");

    const summary = store.getLastRunSummary();
    expect(summary).not.toBeNull();
    expect(summary?.run.debug_run_id).toBe("dbg-1");
    expect(summary?.run.status).toBe("ok");
    expect(summary?.run.trace_id).toBe(run.trace_id);
    expect(summary?.event_count).toBe(2);
    expect(summary?.events.map((event) => event.event)).toEqual([
      "session_loaded",
      "parse_started",
    ]);
    expect(summary?.events.every((event) => event.trace_id === run.trace_id)).toBe(true);
  });

  it("sanitizes sensitive and non-scalar attrs", () => {
    const store = createImportDebugStore();
    store.startRun({ debug_run_id: "dbg-2" });
    store.append("dbg-2", {
      event: "run_failed",
      attrs: {
        error_message: "boom",
        session_token: "secret",
        profile: { phone: "+79990000000" },
        retries: 2,
      },
    });

    const summary = store.getLastRunSummary();
    expect(summary?.events[0]?.attrs).toEqual({
      error_message: "boom",
      retries: 2,
    });
  });

  it("evicts old runs by ring-buffer size", () => {
    const store = createImportDebugStore(2);
    store.startRun({ debug_run_id: "dbg-a" });
    store.startRun({ debug_run_id: "dbg-b" });
    store.startRun({ debug_run_id: "dbg-c" });

    expect(store.getLastRunSummary()?.run.debug_run_id).toBe("dbg-c");

    store.append("dbg-a", { event: "should_not_exist" });
    const summary = store.getLastRunSummary();
    expect(summary?.event_count).toBe(0);
  });

  it("clears all runs", () => {
    const store = createImportDebugStore();
    store.startRun({ debug_run_id: "dbg-3" });
    expect(store.getLastRunSummary()).not.toBeNull();
    store.clearRuns();
    expect(store.getLastRunSummary()).toBeNull();
  });
});
