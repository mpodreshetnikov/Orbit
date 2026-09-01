import { describe, expect, it, vi } from "vitest";
import { runImportSession, tryCompleteSessionAsFailed } from "./import-runner.js";

describe("import-runner", () => {
  it("runs connector parse + preview + complete flow and marks result as review-ready", async () => {
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
        chunk_index: 0,
        chunk_count: 1,
        row_offset: 0,
        is_final_chunk: true,
        total_row_count: 1,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenCalledTimes(4);
    expect(broadcastToAppTabs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "parse_completed",
        progress_percent: 60,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "preview_rows_started",
        progress_percent: 75,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "complete_session_started",
        progress_percent: 90,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        type: "MONEY_IMPORT_DONE",
        phase: "review_ready",
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
      // Carried back for a scheduled run, which must not walk its backfill cursor past a
      // window it only saw part of. Nothing extra is sent to the server.
      import_completeness: { unread_receipt_count: 0, partial: false },
    });
  });

  it("chunks preview rows requests and aggregates totals before completion", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ id: index + 1 }));
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows,
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 120,
      }),
    };

    const callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2", inserted: 2, skipped: 1, error_count: 0 })
      .mockResolvedValueOnce({ batch_id: "batch-2", inserted: 3, skipped: 2, error_count: 1 })
      .mockResolvedValueOnce({ batch_id: "batch-2", inserted: 4, skipped: 0, error_count: 2 })
      .mockResolvedValueOnce({ ok: true });
    const broadcastToAppTabs = vi.fn().mockResolvedValue(undefined);

    const result = await runImportSession(
      {
        source: "tbank_web",
        function_url: "https://example.com/fn",
        session_token: "token",
        session_id: "session-1",
        batch_id: "batch-1",
        payer_person_id: "person-1",
      },
      "2026-01-01T00:00:00.000Z",
      {
        getConnector: () => connector as never,
        callEdge,
        broadcastToAppTabs,
        nowIso: () => "2026-01-01T00:00:00.000Z",
      },
    );

    expect(callEdge).toHaveBeenCalledTimes(4);
    expect(callEdge.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        chunk_index: 0,
        chunk_count: 3,
        row_offset: 0,
        is_final_chunk: false,
        total_row_count: 120,
        rows: rows.slice(0, 50),
      }),
    );
    expect(callEdge.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        chunk_index: 1,
        chunk_count: 3,
        row_offset: 50,
        is_final_chunk: false,
        total_row_count: 120,
        rows: rows.slice(50, 100),
      }),
    );
    expect(callEdge.mock.calls[2]?.[2]).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        chunk_index: 2,
        chunk_count: 3,
        row_offset: 100,
        is_final_chunk: true,
        total_row_count: 120,
        rows: rows.slice(100),
      }),
    );
    expect(callEdge.mock.calls[3]?.[2]).toEqual(
      expect.objectContaining({
        action: "complete_session",
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "preview_rows_started",
        progress_percent: 75,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "preview_rows_started",
        progress_percent: 82,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "preview_rows_started",
        progress_percent: 89,
      }),
    );
    expect(result).toEqual({
      batch_id: "batch-2",
      inserted: 9,
      skipped: 3,
      error_count: 3,
      import_completeness: { unread_receipt_count: 0, partial: false },
    });
  });

  it("aborts chunked preview on the first failing chunk and skips successful completion", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({ id: index + 1 }));
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows,
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 60,
      }),
    };

    const callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2", inserted: 2, skipped: 1, error_count: 0 })
      .mockRejectedValueOnce(new Error("preview chunk failed"));

    await expect(
      runImportSession(
        {
          source: "tbank_web",
          function_url: "https://example.com/fn",
          session_token: "token",
          session_id: "session-1",
          batch_id: "batch-1",
          payer_person_id: "person-1",
        },
        "2026-01-01T00:00:00.000Z",
        {
          getConnector: () => connector as never,
          callEdge,
          broadcastToAppTabs: vi.fn().mockResolvedValue(undefined),
          nowIso: () => "2026-01-01T00:00:00.000Z",
        },
      ),
    ).rejects.toThrow("preview chunk failed");

    expect(callEdge).toHaveBeenCalledTimes(2);
    expect(callEdge.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        chunk_index: 1,
        chunk_count: 2,
        row_offset: 50,
        is_final_chunk: true,
        total_row_count: 60,
      }),
    );
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

  it("forwards granular connector parsing progress before parse completion", async () => {
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockImplementation(async (input: { debug?: Record<string, unknown> }) => {
        const onProgress = input.debug?.on_progress as
          | ((payload: Record<string, unknown>) => Promise<void>)
          | undefined;
        await onProgress?.({
          phase: "parse_fetching_ranges",
          progress_percent: 32,
          parsed_transactions_count: 7,
        });
        await onProgress?.({
          phase: "parse_mapping_rows",
          progress_percent: 58,
          parsed_transactions_count: 9,
        });

        return {
          rows: [{ id: 1 }],
          windowTo: "2026-02-20T00:00:00.000Z",
          parsedThroughAt: "2026-02-19T00:00:00.000Z",
          parsedTransactionsCount: 9,
        };
      }),
    };

    const callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2", inserted: 1, skipped: 0, error_count: 0 })
      .mockResolvedValueOnce({ ok: true });
    const broadcastToAppTabs = vi.fn().mockResolvedValue(undefined);

    await runImportSession(
      {
        source: "tbank_web",
        function_url: "https://example.com/fn",
        session_token: "token",
        session_id: "session-1",
        batch_id: "batch-1",
      },
      "2026-01-01T00:00:00.000Z",
      {
        getConnector: () => connector as never,
        callEdge,
        broadcastToAppTabs,
        nowIso: () => "2026-01-01T00:00:00.000Z",
      },
    );

    expect(broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "parse_fetching_ranges",
        progress_percent: 32,
        parsed_transactions_count: 7,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "parse_mapping_rows",
        progress_percent: 58,
        parsed_transactions_count: 9,
      }),
    );
    expect(broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "parse_completed",
        progress_percent: 60,
        parsed_transactions_count: 9,
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

  it("prefers resolved session window over last_imported_at fallback", async () => {
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-03-08T00:00:00.000Z",
        parsedThroughAt: "2026-03-01T00:00:00.000Z",
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
        window_from: "2026-02-01T00:00:00.000Z",
        window_to: "2026-03-08T00:00:00.000Z",
        last_imported_at: "2025-01-01T00:00:00.000Z",
      },
      undefined,
      {
        getConnector: () => connector as never,
        callEdge,
        broadcastToAppTabs: vi.fn().mockResolvedValue(undefined),
        nowIso: () => "2026-03-08T00:00:00.000Z",
      },
    );

    expect(connector.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        windowFrom: "2026-02-01T00:00:00.000Z",
        windowTo: "2026-03-08T00:00:00.000Z",
      }),
    );
    expect(callEdge.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        window_from: "2026-02-01T00:00:00.000Z",
        window_to: "2026-03-08T00:00:00.000Z",
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
