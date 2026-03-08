import { describe, expect, it, vi } from "vitest";
import { runImportSession, tryCompleteSessionAsFailed } from "./import-runner.js";

describe("import-runner", () => {
  it("runs connector parse + preview + complete flow", async () => {
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    };

    const callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2", inserted: 1, skipped: 0, error_count: 0 })
      .mockResolvedValueOnce({ ok: true });
    const broadcastToAppTabs = vi.fn().mockResolvedValue(undefined);

    const session = {
      source: "tbank_web",
      function_url: "https://example.com/fn",
      session_token: "token",
      session_id: "session-1",
      batch_id: "batch-1",
      payer_person_id: "person-1",
      default_account_id: "acc-default",
    };

    const debugEmit = vi.fn();
    const result = await runImportSession(
      session,
      "2026-01-01T00:00:00.000Z",
      {
        getConnector: () => connector as never,
        callEdge,
        broadcastToAppTabs,
        nowIso: () => "2026-01-01T00:00:00.000Z",
      },
      {
        enabled: true,
        debugRunId: "dbg-1",
        emit: debugEmit,
      },
    );

    expect(connector.parse).toHaveBeenCalledOnce();
    expect(callEdge).toHaveBeenCalledTimes(2);
    expect(callEdge.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        payer_person_id: "person-1",
        default_account_id: "acc-default",
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenCalledTimes(2);
    expect(broadcastToAppTabs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "parse_completed",
        progress_percent: 40,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "MONEY_IMPORT_DONE",
        phase: "completed",
        progress_percent: 100,
      }),
    );
    expect(debugEmit).toHaveBeenCalledWith("parse_started", expect.any(Object));
    expect(debugEmit).toHaveBeenCalledWith(
      "preview_rows_started",
      expect.objectContaining({
        batch_id: "batch-1",
        session_id: "session-1",
        payer_person_id_present: true,
      }),
    );
    expect(debugEmit).toHaveBeenCalledWith(
      "preview_rows_completed",
      expect.objectContaining({
        batch_id: "batch-2",
        inserted: 1,
        skipped: 0,
        error_count: 0,
      }),
    );
    expect(debugEmit).toHaveBeenCalledWith("complete_session_completed", expect.any(Object));
    expect(result).toEqual({
      batch_id: "batch-2",
      inserted: 1,
      skipped: 0,
      error_count: 0,
    });
  });

  it("supports parse-only debug run without edge calls", async () => {
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
        debug: {
          extraction_method: "dom",
          fallback_used: true,
          fallback_reason: "No operations returned by API",
        },
      }),
    };
    const callEdge = vi.fn();
    const broadcastToAppTabs = vi.fn().mockResolvedValue(undefined);
    const debugEmit = vi.fn();

    const result = await runImportSession(
      {
        source: "tbank_web",
        batch_id: "batch-debug",
      },
      "2026-01-01T00:00:00.000Z",
      {
        getConnector: () => connector as never,
        callEdge,
        broadcastToAppTabs,
        nowIso: () => "2026-01-01T00:00:00.000Z",
      },
      {
        enabled: true,
        parseOnly: true,
        debugRunId: "dbg-2",
        emit: debugEmit,
      },
    );

    expect(callEdge).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      batch_id: "batch-debug",
      parse_only: true,
      debug_run_id: "dbg-2",
    });
    expect(debugEmit).toHaveBeenCalledWith(
      "parse_completed",
      expect.objectContaining({
        extraction_method: "dom",
        fallback_used: true,
        fallback_reason: "No operations returned by API",
      }),
    );
    expect(debugEmit).toHaveBeenCalledWith("complete_session_started", { parse_only: true });
    expect(debugEmit).toHaveBeenCalledWith("complete_session_completed", { parse_only: true });
    expect(broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_DONE",
        parse_only: true,
        phase: "parse_only_completed",
        progress_percent: 100,
      }),
    );
  });

  it("does not force windowFrom to now when session has no last_imported_at", async () => {
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    };

    const callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2", inserted: 1, skipped: 0, error_count: 0 })
      .mockResolvedValueOnce({ ok: true });

    await runImportSession(
      {
        source: "tbank_web",
        function_url: "https://example.com/fn",
        session_token: "token",
        session_id: "session-1",
        batch_id: "batch-1",
        payer_person_id: "person-1",
      },
      undefined,
      {
        getConnector: () => connector as never,
        callEdge,
        broadcastToAppTabs: vi.fn().mockResolvedValue(undefined),
        nowIso: () => "2026-03-06T00:00:00.000Z",
      },
    );

    expect(connector.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        windowFrom: undefined,
      }),
    );
  });

  it("swallows failure completion errors", async () => {
    const callEdge = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      tryCompleteSessionAsFailed(
        {
          function_url: "https://example.com/fn",
          session_token: "token",
          session_id: "session-1",
          batch_id: "batch-1",
        },
        callEdge,
      ),
    ).resolves.toBeUndefined();
  });
});
