import { describe, expect, it, vi } from "vitest";
import extensionManifest from "../../manifest.json";
import { createImportDebugStore } from "./import-debug.js";
import { routeBackgroundMessage } from "./background-router.js";
import type { StoredImportGrant } from "./grant-store.js";
import { createInitialAutoRunState } from "./auto-run-policy.js";

describe("background-router", () => {
  /**
   * An https host the manifest permits, for a function_url the grant parser will accept. The
   * first permission is localhost over http, and a test that took it and returned early on the
   * https regex passed without running -- so this fails loudly instead of skipping.
   */
  function permittedHttpsHost(): string {
    const permitted = (extensionManifest.host_permissions ?? []).find((pattern) =>
      /^https:\/\/[^*/]+\//.test(pattern),
    );
    const host = permitted ? /^https:\/\/([^/]+)\//.exec(permitted)?.[1] : undefined;
    expect(host).toBeDefined();
    return host as string;
  }

  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function createDeps() {
    return {
      grantStore: {
        getGrant: vi.fn(async (): Promise<StoredImportGrant | null> => null),
        setGrant: vi.fn(async () => {}),
      },
      sessionStore: {
        getSession: vi.fn(),
        setSession: vi.fn(),
      },
      importRunnerDeps: {
        getConnector: vi.fn(),
        callEdge: vi.fn(),
        broadcastToAppTabs: vi.fn().mockResolvedValue(undefined),
        broadcastToSourceTab: vi.fn().mockResolvedValue(undefined),
        nowIso: vi.fn(() => "2026-01-01T00:00:00.000Z"),
      },
      autoRunStore: {
        getState: vi.fn(async (_scope: { sourceId: string; payerPersonId: string }) =>
          createInitialAutoRunState(),
        ),
        setState: vi.fn(async () => {}),
        forgiveFailures: vi.fn(async () => 0),
      },
      debugStore: createImportDebugStore(),
    };
  }

  it("stores a grant the app sends, and refuses one pointed elsewhere", async () => {
    const deps = createDeps();
    const host = permittedHttpsHost();

    await expect(
      routeBackgroundMessage(
        {
          type: "MONEY_IMPORT_SET_GRANT",
          grant: {
            token: "plain-token",
            person_id: "person-1",
            allowed_sources: ["tbank_web"],
            function_url: `https://${host}/functions/v1/money-import`,
          },
        },
        deps,
      ),
    ).resolves.toEqual({ ok: true });
    expect(deps.grantStore.setGrant).toHaveBeenCalledTimes(1);

    // Anything on the app's page can post one of these; the url is where the token would go.
    await expect(
      routeBackgroundMessage(
        {
          type: "MONEY_IMPORT_SET_GRANT",
          grant: {
            token: "plain-token",
            person_id: "person-1",
            allowed_sources: ["tbank_web"],
            function_url: "https://attacker.example/functions/v1/money-import",
          },
        },
        deps,
      ),
    ).resolves.toEqual({ ok: false, error: "Grant payload was rejected" });
    expect(deps.grantStore.setGrant).toHaveBeenCalledTimes(1);
  });

  it("takes the grant's origin from the page that sent it, and refuses one pointed elsewhere", async () => {
    const deps = createDeps();
    const host = permittedHttpsHost();
    const grant = {
      token: "plain-token",
      person_id: "person-1",
      allowed_sources: ["tbank_web"],
      function_url: `https://${host}/functions/v1/money-import`,
    };
    const context = { senderOrigin: "https://app.example.com" };

    // Left out: filled in from the sender.
    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_SET_GRANT", grant }, deps, context),
    ).resolves.toEqual({ ok: true });
    expect(deps.grantStore.setGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ app_origin: "https://app.example.com" }),
    );

    // The sender's own: kept.
    await expect(
      routeBackgroundMessage(
        {
          type: "MONEY_IMPORT_SET_GRANT",
          grant: { ...grant, app_origin: "https://app.example.com/" },
        },
        deps,
        context,
      ),
    ).resolves.toEqual({ ok: true });

    // Somewhere else: this is the page asking the extension to send the person there later.
    await expect(
      routeBackgroundMessage(
        { type: "MONEY_IMPORT_SET_GRANT", grant: { ...grant, app_origin: "https://evil.example" } },
        deps,
        context,
      ),
    ).resolves.toEqual({ ok: false, error: "Grant payload was rejected" });
    expect(deps.grantStore.setGrant).toHaveBeenCalledTimes(2);
  });

  it("reports a held grant without handing the token back to the page", async () => {
    const deps = createDeps();
    deps.grantStore.getGrant.mockResolvedValue({
      token: "plain-token",
      person_id: "person-1",
      allowed_sources: ["tbank_web"],
      function_url: "https://example.supabase.co/functions/v1/money-import",
      app_origin: "https://orbit.example",
      received_at: "2026-09-01T12:00:00.000Z",
    });

    const reply = await routeBackgroundMessage({ type: "MONEY_IMPORT_GET_GRANT" }, deps);
    expect(reply).toEqual({
      ok: true,
      grant: {
        person_id: "person-1",
        allowed_sources: ["tbank_web"],
        received_at: "2026-09-01T12:00:00.000Z",
      },
    });
    // The secret has already left the page once. It does not go back.
    expect(JSON.stringify(reply)).not.toContain("plain-token");
  });

  it("clears a grant on request", async () => {
    const deps = createDeps();
    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_CLEAR_GRANT" }, deps),
    ).resolves.toEqual({ ok: true });
    expect(deps.grantStore.setGrant).toHaveBeenCalledWith(null);
  });

  it("reports what the extension will do on its own, without the token", async () => {
    const deps = createDeps();
    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_GET_AUTO_STATUS" }, deps),
    ).resolves.toEqual({ ok: true, grant: null, sources: [] });

    deps.grantStore.getGrant.mockResolvedValue({
      token: "secret",
      person_id: "person-1",
      allowed_sources: ["tbank_web", "alfa_web", "retired_web"],
      function_url: "https://example.test/functions/v1/money-import",
      app_origin: "https://app.example.test",
      received_at: "2026-09-03T05:00:00.000Z",
    });
    const failedAt = Date.parse("2026-09-03T05:02:00.000Z");
    deps.autoRunStore.getState.mockImplementation(async (scope: { sourceId: string }) =>
      scope.sourceId === "tbank_web"
        ? {
            lastRunAtMs: failedAt,
            lastResult: "error" as const,
            consecutiveFailures: 1,
            lastError: "T-Bank did not stay on the operations page",
            lastRunOrigin: "auto" as const,
          }
        : createInitialAutoRunState(),
    );
    const status = await routeBackgroundMessage(
      { type: "MONEY_IMPORT_GET_AUTO_STATUS" },
      {
        ...deps,
        now: () => failedAt + 60_000,
        listAutoImportSources: () => ["tbank_web", "alfa_web"],
        // T-Bank's visit alarm fires inside its cooldown, so the policy will turn it away;
        // Alfa's is a run.
        listScheduledSweeps: async () => [
          { sourceId: "tbank_web", atMs: failedAt + 60_000 },
          { sourceId: "alfa_web", atMs: failedAt + 60_000 },
        ],
      },
    );

    expect(JSON.stringify(status)).not.toContain("secret");
    expect(status).toEqual({
      ok: true,
      grant: {
        person_id: "person-1",
        allowed_sources: ["tbank_web", "alfa_web", "retired_web"],
        received_at: "2026-09-03T05:00:00.000Z",
      },
      sources: [
        {
          source_id: "tbank_web",
          last_run_at: "2026-09-03T05:02:00.000Z",
          last_result: "error",
          consecutive_failures: 1,
          last_error: "T-Bank did not stay on the operations page",
          last_run_origin: "auto",
          // One failure: the ordinary twenty-hour cooldown, not yet doubled.
          next_run: { kind: "after", at: "2026-09-04T01:02:00.000Z" },
          scheduled_at: null,
        },
        {
          source_id: "alfa_web",
          last_run_at: null,
          last_result: null,
          consecutive_failures: 0,
          last_error: null,
          last_run_origin: null,
          next_run: { kind: "now" },
          scheduled_at: "2026-09-03T05:03:00.000Z",
        },
      ],
    });
  });

  it("handles ping + unsupported message", async () => {
    const deps = createDeps();
    await expect(routeBackgroundMessage({ type: "MONEY_IMPORT_PING" }, deps)).resolves.toEqual({
      ok: true,
      extension_id: "unit-test",
      // Read from the manifest, which is what the router reports. Duplicating
      // the literal here means every release version bump breaks this test.
      extension_version: extensionManifest.version,
    });
    await expect(routeBackgroundMessage({ type: "UNKNOWN" }, deps)).resolves.toEqual({
      ok: false,
      error: "Unsupported message type",
    });
  });

  it("starts and gets session", async () => {
    const deps = createDeps();
    deps.sessionStore.getSession.mockResolvedValue({ source: "tbank_web" });

    await expect(
      routeBackgroundMessage(
        { type: "MONEY_IMPORT_START_SESSION", session: { source: "tbank_web" } },
        deps,
      ),
    ).resolves.toEqual({ ok: true });
    expect(deps.sessionStore.setSession).toHaveBeenCalledWith({ source: "tbank_web" });

    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_GET_SESSION" }, deps),
    ).resolves.toEqual({
      ok: true,
      session: { source: "tbank_web" },
      active_run: null,
    });
  });

  it("includes active run snapshot when session is requested during an in-flight import", async () => {
    const deps = createDeps();
    const parseDeferred = createDeferred<{
      rows: Array<{ id: number }>;
      windowTo: string;
      parsedThroughAt: string;
      parsedTransactionsCount: number;
    }>();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockReturnValue(parseDeferred.promise),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.importRunnerDeps.callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2" })
      .mockResolvedValueOnce({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
    });

    const runPromise = routeBackgroundMessage(
      {
        type: "MONEY_IMPORT_RUN",
        origin: "source_page_overlay",
      },
      deps,
      { senderTabId: 777 },
    );

    await Promise.resolve();

    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_GET_SESSION" }, deps),
    ).resolves.toEqual({
      ok: true,
      session: {
        source: "tbank_web",
        session_id: "session-1",
        batch_id: "batch-1",
        function_url: "https://example.com/fn",
        session_token: "token",
      },
      active_run: expect.objectContaining({
        running: true,
        phase: "starting",
        progress_percent: 2,
        batch_id: "batch-1",
      }),
    });

    parseDeferred.resolve({
      rows: [{ id: 1 }],
      windowTo: "2026-02-20T00:00:00.000Z",
      parsedThroughAt: "2026-02-19T00:00:00.000Z",
      parsedTransactionsCount: 1,
    });

    await expect(runPromise).resolves.toMatchObject({ ok: true });
  });

  it("fails run when session is missing", async () => {
    const deps = createDeps();
    deps.sessionStore.getSession.mockResolvedValue(null);

    await expect(routeBackgroundMessage({ type: "MONEY_IMPORT_RUN" }, deps)).rejects.toThrow(
      "No active import session",
    );
  });

  it("rebroadcasts granular parse progress emitted from the page script", async () => {
    const deps = createDeps();
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
    });

    await expect(
      routeBackgroundMessage(
        {
          type: "MONEY_IMPORT_PROGRESS",
          session_id: "session-1",
          phase: "parse_fetching_ranges",
          progress_percent: 32,
          parsed_transactions_count: 7,
          estimated_total_ms: 753000,
          estimated_remaining_ms: 741000,
          estimated_receipt_request_count: 108,
          estimate_updated_at: "2026-03-10T00:00:00.000Z",
        } as never,
        deps,
        { senderTabId: 777 },
      ),
    ).resolves.toEqual({ ok: true });

    expect(deps.importRunnerDeps.broadcastToAppTabs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "parse_fetching_ranges",
        progress_percent: 32,
        parsed_transactions_count: 7,
        estimated_total_ms: 753000,
        estimated_remaining_ms: 741000,
        estimated_receipt_request_count: 108,
        estimate_updated_at: "2026-03-10T00:00:00.000Z",
      }),
    );
    expect(deps.importRunnerDeps.broadcastToSourceTab).toHaveBeenCalledWith(
      777,
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
        phase: "parse_fetching_ranges",
        progress_percent: 32,
        estimated_total_ms: 753000,
        estimated_remaining_ms: 741000,
      }),
    );
  });

  it("returns existing transaction states via the active import session", async () => {
    const deps = createDeps();
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      function_url: "https://example.com/fn",
      user_access_token: "user-token",
      payer_person_id: "person-1",
    });
    deps.importRunnerDeps.callEdge.mockResolvedValue({
      states: [
        {
          transaction_id: "tx-1",
          exists: true,
          fulfilled: false,
          has_only_synthetic_line_items: true,
          has_real_line_items: false,
          receipt_enrichment_status: "ok",
        },
      ],
    });

    await expect(
      routeBackgroundMessage(
        {
          type: "MONEY_IMPORT_GET_EXISTING_TRANSACTION_STATES",
          source: "tbank_web",
          payer_person_id: "person-1",
          candidates: [
            {
              external_id: "ext-1",
              dedupe_hash: "hash-1",
              posted_at: "2026-01-01T00:00:00.000Z",
              amount: 10,
            },
          ],
        } as never,
        deps,
      ),
    ).resolves.toEqual({
      ok: true,
      states: [
        {
          transaction_id: "tx-1",
          exists: true,
          fulfilled: false,
          has_only_synthetic_line_items: true,
          has_real_line_items: false,
          receipt_enrichment_status: "ok",
        },
      ],
    });

    expect(deps.importRunnerDeps.callEdge).toHaveBeenCalledWith(
      "https://example.com/fn",
      "user-token",
      expect.objectContaining({
        action: "get_existing_transaction_states",
        source: "tbank_web",
        payer_person_id: "person-1",
      }),
    );
  });

  it("supports debug get/clear without active run", async () => {
    const deps = createDeps();

    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN" }, deps),
    ).resolves.toEqual({
      ok: true,
      run: null,
    });

    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_DEBUG_CLEAR_RUNS" }, deps),
    ).resolves.toEqual({
      ok: true,
    });

    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_DEBUG_EXPORT_LAST_RUN" }, deps),
    ).resolves.toEqual({
      ok: false,
      error: "No debug run available for export.",
    });
  });

  it("runs parse-only import with debug traceability", async () => {
    const deps = createDeps();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 0,
        debug: {
          extraction_method: "api",
          fallback_used: false,
        },
      }),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
    });

    const response = await routeBackgroundMessage(
      {
        type: "MONEY_IMPORT_RUN",
        debug: { enabled: true, parse_only: true },
      },
      deps,
    );

    expect(response.ok).toBe(true);
    expect((response as { debug_run_id?: string }).debug_run_id).toBeTruthy();
    expect(deps.sessionStore.setSession).toHaveBeenCalledWith(null);

    const lastRun = await routeBackgroundMessage({ type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN" }, deps);
    expect((lastRun as { run?: { run?: { status?: string } } }).run?.run?.status).toBe("ok");
  });

  it("records full debug event sequence for a successful run", async () => {
    const deps = createDeps();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
        debug: {
          extraction_method: "api",
          fallback_used: false,
        },
      }),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.importRunnerDeps.callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2" })
      .mockResolvedValueOnce({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
    });

    await routeBackgroundMessage(
      {
        type: "MONEY_IMPORT_RUN",
        debug: { enabled: true },
      },
      deps,
    );

    const lastRun = (await routeBackgroundMessage(
      { type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN" },
      deps,
    )) as {
      run: {
        events: Array<{ event: string }>;
      };
    };
    expect(lastRun.run.events.map((event) => event.event)).toEqual([
      "session_loaded",
      "connector_resolved",
      "parse_started",
      "parse_completed",
      "preview_rows_started",
      "preview_rows_completed",
      "complete_session_started",
      "complete_session_completed",
    ]);

    const exportResponse = (await routeBackgroundMessage(
      { type: "MONEY_IMPORT_DEBUG_EXPORT_LAST_RUN" },
      deps,
    )) as {
      ok: boolean;
      bundle?: {
        exported_at?: string;
        run?: { run?: { status?: string } };
      };
    };
    expect(exportResponse.ok).toBe(true);
    expect(typeof exportResponse.bundle?.exported_at).toBe("string");
    expect(exportResponse.bundle?.run?.run?.status).toBe("ok");
    expect(deps.sessionStore.setSession).toHaveBeenCalledWith(null);
  });

  it("broadcasts progress events to source tab when run is started from source page overlay", async () => {
    const deps = createDeps();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.importRunnerDeps.callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2" })
      .mockResolvedValueOnce({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
      app_origin: "http://localhost:3000",
    });

    const response = await routeBackgroundMessage(
      {
        type: "MONEY_IMPORT_RUN",
        origin: "source_page_overlay",
      },
      deps,
      { senderTabId: 777 },
    );

    expect(response).toMatchObject({
      ok: true,
      report_url: "http://localhost:3000/money/import/reports/batch-2",
    });

    expect(deps.importRunnerDeps.broadcastToAppTabs).toHaveBeenCalled();
    expect(deps.importRunnerDeps.broadcastToSourceTab).toHaveBeenCalledWith(
      777,
      expect.objectContaining({
        type: "MONEY_IMPORT_PROGRESS",
      }),
    );
    expect(deps.importRunnerDeps.broadcastToSourceTab).toHaveBeenCalledWith(
      777,
      expect.objectContaining({
        type: "MONEY_IMPORT_DONE",
      }),
    );
  });

  it("does not provide report url for popup-origin runs", async () => {
    const deps = createDeps();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.importRunnerDeps.callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-popup" })
      .mockResolvedValueOnce({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
      app_origin: "http://localhost:3000",
    });

    const response = await routeBackgroundMessage(
      {
        type: "MONEY_IMPORT_RUN",
        origin: "popup",
      },
      deps,
      { senderTabId: 999 },
    );

    expect(response).toMatchObject({ ok: true });
    expect(response).not.toHaveProperty("report_url");
  });

  it("records resolved session window in debug run state", async () => {
    const deps = createDeps();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-03-08T00:00:00.000Z",
        parsedThroughAt: "2026-03-01T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.importRunnerDeps.callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-popup" })
      .mockResolvedValueOnce({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
      window_from: "2026-02-01T00:00:00.000Z",
      window_to: "2026-03-08T00:00:00.000Z",
      last_imported_at: "2025-01-01T00:00:00.000Z",
    });

    await routeBackgroundMessage(
      {
        type: "MONEY_IMPORT_RUN",
        origin: "popup",
        debug: { enabled: true },
      },
      deps,
    );

    const lastRun = (await routeBackgroundMessage(
      { type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN" },
      deps,
    )) as {
      run?: {
        run?: {
          window_from?: string | null;
        };
      };
    };

    expect(lastRun.run?.run?.window_from).toBe("2026-02-01T00:00:00.000Z");
  });

  it("persists structured edge diagnostics in run_failed event", async () => {
    const deps = createDeps();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.importRunnerDeps.callEdge = vi.fn().mockRejectedValue(
      Object.assign(new Error("Edge fetch failed (preview_rows): Failed to fetch"), {
        code: "EDGE_FETCH_FAILED",
        action: "preview_rows",
        function_host: "abc.supabase.co",
        function_path: "/functions/v1/money-import",
        http_status: null,
        response_error: "Failed to fetch",
        transport: "network",
      }),
    );
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://abc.supabase.co/functions/v1/money-import",
      session_token: "token",
    });

    await expect(
      routeBackgroundMessage(
        {
          type: "MONEY_IMPORT_RUN",
          debug: { enabled: true },
        },
        deps,
      ),
    ).rejects.toThrow("Edge fetch failed");

    const lastRun = (await routeBackgroundMessage(
      { type: "MONEY_IMPORT_DEBUG_GET_LAST_RUN" },
      deps,
    )) as {
      run: {
        events: Array<{ event: string; attrs?: Record<string, unknown> }>;
      };
    };
    const failedEvent = lastRun.run.events.find((event) => event.event === "run_failed");
    expect(failedEvent?.attrs).toMatchObject({
      error_code: "EDGE_FETCH_FAILED",
      edge_action: "preview_rows",
      edge_host: "abc.supabase.co",
      edge_transport: "network",
    });
    expect(deps.sessionStore.setSession).toHaveBeenCalledWith(null);
  });

  it("rejects duplicate import runs while a session run is already in flight", async () => {
    const deps = createDeps();
    const parseDeferred = createDeferred<{
      rows: Array<{ id: number }>;
      windowTo: string;
      parsedThroughAt: string;
      parsedTransactionsCount: number;
    }>();
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockReturnValue(parseDeferred.promise),
    };
    deps.importRunnerDeps.getConnector.mockReturnValue(connector);
    deps.importRunnerDeps.callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2" })
      .mockResolvedValueOnce({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank_web",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
    });

    const firstRunPromise = routeBackgroundMessage(
      {
        type: "MONEY_IMPORT_RUN",
      },
      deps,
    );

    await expect(
      routeBackgroundMessage(
        {
          type: "MONEY_IMPORT_RUN",
        },
        deps,
      ),
    ).rejects.toThrow("Import already running for session session-1");

    parseDeferred.resolve({
      rows: [{ id: 1 }],
      windowTo: "2026-02-20T00:00:00.000Z",
      parsedThroughAt: "2026-02-19T00:00:00.000Z",
      parsedTransactionsCount: 1,
    });

    await expect(firstRunPromise).resolves.toMatchObject({ ok: true });
    expect(deps.importRunnerDeps.callEdge).toHaveBeenCalledTimes(2);
  });

  it("clears the automatic backoff when a run the person started succeeds", async () => {
    const deps = createDeps();
    deps.autoRunStore.getState = vi.fn(async () => ({
      lastRunAtMs: Date.parse("2026-08-20T00:00:00.000Z"),
      lastResult: "error" as const,
      // Three is the point at which `shouldAutoRun` stops trying at all. Without this reset a
      // spell of being signed out would end automatic import for good.
      consecutiveFailures: 3,
    }));
    deps.importRunnerDeps.getConnector.mockReturnValue({
      sourceId: "tbank",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-08-23T00:00:00.000Z",
        parsedThroughAt: "2026-08-23T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    });
    deps.importRunnerDeps.callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2" })
      .mockResolvedValueOnce({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank",
      payer_person_id: "person-1",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
    });

    await expect(routeBackgroundMessage({ type: "MONEY_IMPORT_RUN" }, deps)).resolves.toMatchObject(
      { ok: true },
    );

    expect(deps.autoRunStore.setState).toHaveBeenCalledWith(
      { sourceId: "tbank", payerPersonId: "person-1" },
      expect.objectContaining({
        lastResult: "ok",
        consecutiveFailures: 0,
        lastRunOrigin: "manual",
      }),
    );
  });

  it("leaves the automatic backoff alone when a run fails", async () => {
    const deps = createDeps();
    deps.importRunnerDeps.getConnector.mockReturnValue({
      sourceId: "tbank",
      parse: vi.fn().mockRejectedValue(new Error("still signed out")),
    });
    deps.importRunnerDeps.callEdge = vi.fn().mockResolvedValue({ ok: true });
    deps.sessionStore.getSession.mockResolvedValue({
      source: "tbank",
      session_id: "session-1",
      batch_id: "batch-1",
      function_url: "https://example.com/fn",
      session_token: "token",
    });

    await expect(routeBackgroundMessage({ type: "MONEY_IMPORT_RUN" }, deps)).rejects.toThrow(
      "still signed out",
    );
    expect(deps.autoRunStore.setState).not.toHaveBeenCalled();
  });
  describe("attention", () => {
    const NOW = Date.parse("2026-09-03T12:00:00.000Z");
    const DAY = 24 * 60 * 60 * 1000;

    function createAttentionStore(initial?: {
      staleAfterMs?: number;
      lastOpenedAtMs?: number | null;
      runRequests?: Record<string, number>;
    }) {
      const state = {
        staleAfterMs: initial?.staleAfterMs ?? DAY,
        lastOpenedAtMs: initial?.lastOpenedAtMs ?? null,
        runRequests: { ...(initial?.runRequests ?? {}) },
      };
      return {
        state,
        getState: vi.fn(async () => ({ ...state, runRequests: { ...state.runRequests } })),
        setStaleAfterMs: vi.fn(async (value: unknown) => {
          state.staleAfterMs = typeof value === "number" ? value : DAY;
          return state.staleAfterMs;
        }),
        markPageOpened: vi.fn(async (nowMs: number) => {
          state.lastOpenedAtMs = nowMs;
        }),
        requestRun: vi.fn(
          async (scope: { sourceId: string; payerPersonId: string }, nowMs: number) => {
            state.runRequests[`${scope.sourceId}::${scope.payerPersonId}`] = nowMs;
          },
        ),
        isRunRequested: vi.fn(
          async (scope: { sourceId: string; payerPersonId: string }) =>
            `${scope.sourceId}::${scope.payerPersonId}` in state.runRequests,
        ),
        clearRunRequest: vi.fn(async (scope: { sourceId: string; payerPersonId: string }) => {
          delete state.runRequests[`${scope.sourceId}::${scope.payerPersonId}`];
        }),
      };
    }

    function createGrant(): StoredImportGrant {
      return {
        token: "grant-token",
        person_id: "person-1",
        allowed_sources: ["tbank_web"],
        function_url: "https://project.supabase.co/functions/v1/money-import",
        app_origin: "https://app.example.com",
        received_at: new Date(NOW - 3 * DAY).toISOString(),
      };
    }

    it("says what is stale without handing the token back", async () => {
      const deps = createDeps();
      deps.grantStore.getGrant.mockResolvedValue(createGrant());
      const attentionStore = createAttentionStore();

      const reply = (await routeBackgroundMessage(
        { type: "MONEY_IMPORT_GET_ATTENTION" },
        {
          ...deps,
          attentionStore,
          listAutoImportSources: () => ["tbank_web"],
          now: () => NOW,
        },
      )) as Record<string, unknown>;

      expect(reply.ok).toBe(true);
      expect(reply.grant).toEqual({
        person_id: "person-1",
        allowed_sources: ["tbank_web"],
        received_at: new Date(NOW - 3 * DAY).toISOString(),
      });
      expect(JSON.stringify(reply)).not.toContain("grant-token");
      expect(reply.stale_count).toBe(1);
      expect(reply.stale_after_ms).toBe(DAY);
      expect((reply.sources as Array<Record<string, unknown>>)[0]).toMatchObject({
        source_id: "tbank_web",
        last_ok_at: null,
        stale: true,
        run_requested: false,
      });
    });

    it("is not available without the store", async () => {
      await expect(
        routeBackgroundMessage({ type: "MONEY_IMPORT_GET_ATTENTION" }, createDeps()),
      ).resolves.toEqual({ ok: false, error: "Attention is not available" });
    });

    it("opens the bank in front of the person and remembers the request, for a covered source only", async () => {
      const deps = createDeps();
      deps.grantStore.getGrant.mockResolvedValue(createGrant());
      const attentionStore = createAttentionStore();
      const opened: string[] = [];
      const routerDeps = {
        ...deps,
        attentionStore,
        resolveSourceTargetUrl: (sourceId: string) =>
          sourceId === "tbank_web" ? "https://www.tbank.ru/mybank/operations/" : null,
        openSourceTab: async (url: string) => {
          opened.push(url);
          return 42;
        },
        now: () => NOW,
      };

      await expect(
        routeBackgroundMessage(
          { type: "MONEY_IMPORT_REQUEST_RUN", source_id: "tbank_web" },
          routerDeps,
        ),
      ).resolves.toEqual({
        ok: true,
        source_id: "tbank_web",
        target_url: "https://www.tbank.ru/mybank/operations/",
        tab_id: 42,
      });
      expect(opened).toEqual(["https://www.tbank.ru/mybank/operations/"]);
      expect(attentionStore.state.runRequests).toEqual({ "tbank_web::person-1": NOW });
      // The attempt history is not touched: nothing has succeeded yet.
      expect(deps.autoRunStore.setState).not.toHaveBeenCalled();

      await expect(
        routeBackgroundMessage(
          { type: "MONEY_IMPORT_REQUEST_RUN", source_id: "alfa_web" },
          routerDeps,
        ),
      ).resolves.toEqual({ ok: false, error: "Source is not covered by the grant" });
      expect(opened).toHaveLength(1);
    });

    it("remembers no request for a bank that did not open", async () => {
      const deps = createDeps();
      deps.grantStore.getGrant.mockResolvedValue(createGrant());
      const attentionStore = createAttentionStore();
      const base = {
        ...deps,
        attentionStore,
        resolveSourceTargetUrl: () => "https://www.tbank.ru/mybank/operations/",
        now: () => NOW,
      };

      await expect(
        routeBackgroundMessage(
          { type: "MONEY_IMPORT_REQUEST_RUN", source_id: "tbank_web" },
          { ...base, openSourceTab: async () => null },
        ),
      ).resolves.toEqual({ ok: false, error: "Could not open the bank" });
      await expect(
        routeBackgroundMessage(
          { type: "MONEY_IMPORT_REQUEST_RUN", source_id: "tbank_web" },
          {
            ...base,
            openSourceTab: async () => {
              throw new Error("no window");
            },
          },
        ),
      ).resolves.toEqual({ ok: false, error: "Could not open the bank: no window" });
      expect(attentionStore.state.runRequests).toEqual({});
    });

    it("refuses a run request without a grant", async () => {
      const deps = createDeps();
      await expect(
        routeBackgroundMessage(
          { type: "MONEY_IMPORT_REQUEST_RUN", source_id: "tbank_web" },
          { ...deps, attentionStore: createAttentionStore() },
        ),
      ).resolves.toEqual({ ok: false, error: "No import grant" });
    });

    it("stores the threshold and echoes what was stored", async () => {
      const attentionStore = createAttentionStore();
      await expect(
        routeBackgroundMessage(
          { type: "MONEY_IMPORT_SET_ATTENTION_SETTINGS", stale_after_ms: 3 * DAY },
          { ...createDeps(), attentionStore },
        ),
      ).resolves.toEqual({ ok: true, stale_after_ms: 3 * DAY });
      expect(attentionStore.setStaleAfterMs).toHaveBeenCalledWith(3 * DAY);
    });
  });
});
