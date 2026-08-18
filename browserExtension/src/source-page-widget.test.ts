// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcePageWidget } from "./source-page-widget.js";

describe("source-page-widget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function getWidgetShadowRoot(): ShadowRoot {
    const host = document.getElementById("orbit-money-import-widget-root") as HTMLDivElement | null;
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();
    return host!.shadowRoot!;
  }

  function getShadowText(): string {
    return getWidgetShadowRoot().textContent ?? "";
  }

  function createHarness() {
    const runtimeSendMessage = vi.fn(
      (
        _message: Record<string, unknown>,
        callback?: (response: Record<string, unknown> | undefined) => void,
      ) => {
        callback?.({
          ok: true,
          session: {
            session_id: "session-1",
            source: "alfa_web",
            app_origin: "http://localhost:3000",
            show_source_page_widget: true,
          },
        });
      },
    );
    const addRuntimeListener = vi.fn();
    const removeRuntimeListener = vi.fn();
    const keepAlivePort = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    const runtimeConnect = vi.fn(() => keepAlivePort);
    const widget = createSourcePageWidget({
      runtimeSendMessage,
      addRuntimeListener,
      removeRuntimeListener,
      runtimeConnect,
    });
    return {
      widget,
      runtimeSendMessage,
      addRuntimeListener,
      removeRuntimeListener,
      runtimeConnect,
      keepAlivePort,
    };
  }

  it("mounts visible UI and starts import with source_page_overlay origin", () => {
    const { widget, runtimeSendMessage } = createHarness();
    widget.mount();

    const button = getWidgetShadowRoot().querySelector(
      '[data-testid="money-import-overlay-run-button"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button?.click();

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_RUN",
        origin: "source_page_overlay",
      }),
      expect.any(Function),
    );
  });

  it("keeps a runtime port open while the source-page widget is mounted", () => {
    vi.useFakeTimers();
    const { widget, runtimeConnect, keepAlivePort } = createHarness();

    widget.mount();

    expect(runtimeConnect).toHaveBeenCalledTimes(1);
    expect(keepAlivePort.postMessage).toHaveBeenCalledWith({
      type: "MONEY_IMPORT_KEEPALIVE",
    });

    vi.advanceTimersByTime(20000);
    expect(keepAlivePort.postMessage).toHaveBeenCalledTimes(2);

    widget.unmount();
    expect(keepAlivePort.disconnect).toHaveBeenCalledTimes(1);
  });

  it("updates progress and review-ready state from runtime messages", () => {
    const { widget } = createHarness();
    widget.mount();

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "apply_rows_started",
      progress_percent: 75,
      parsed_transactions_count: 13,
    });

    expect(getShadowText()).toContain("75%");
    expect(getShadowText()).toContain("13");

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_DONE",
      batch_id: "batch-123",
      phase: "review_ready",
    });

    expect(getShadowText()).toContain("batch-123");
    expect(getShadowText()).toContain("Preview ready for review");
  });

  it("renders human-friendly labels for intermediate import phases", () => {
    const { widget } = createHarness();
    widget.mount();

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "preview_rows_started",
      progress_percent: 65,
    });
    expect(getShadowText()).toContain("Preparing preview 65%");

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "complete_session_started",
      progress_percent: 90,
    });
    expect(getShadowText()).toContain("Finalizing import 90%");
  });

  it("renders granular parsing labels from connector progress events", () => {
    const { widget } = createHarness();
    widget.mount();

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_fetching_ranges",
      progress_percent: 32,
    });
    expect(getShadowText()).toContain("Loading transaction ranges 32%");

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_mapping_rows",
      progress_percent: 58,
    });
    expect(getShadowText()).toContain("Mapping parsed rows 58%");
  });

  it("shows a live full-mode countdown once T-Bank transaction count is known", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));

    const runtimeSendMessage = vi.fn(
      (
        _message: Record<string, unknown>,
        callback?: (response: Record<string, unknown> | undefined) => void,
      ) => {
        callback?.({
          ok: true,
          session: {
            session_id: "session-1",
            source: "tbank_web",
            app_origin: "http://localhost:3000",
            parse_strategy: "full",
            show_source_page_widget: true,
          },
        });
      },
    );

    const widget = createSourcePageWidget({
      runtimeSendMessage,
      addRuntimeListener: vi.fn(),
      removeRuntimeListener: vi.fn(),
    });
    widget.mount();

    expect(getShadowText()).toContain(
      "Full mode ETA appears after the bank counts transactions in the selected range",
    );

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_enriching_operations",
      progress_percent: 44,
      parsed_transactions_count: 108,
      estimated_total_ms: 90000,
      estimated_remaining_ms: 90000,
      estimate_updated_at: "2026-03-10T00:00:00.000Z",
      estimated_receipt_request_count: 18,
    });

    expect(getShadowText()).toContain("Full mode ETA: 01:30");
    expect(getShadowText()).toContain("Receipt detail requests: 18");

    vi.advanceTimersByTime(20000);
    vi.setSystemTime(new Date("2026-03-10T00:00:20.000Z"));

    expect(getShadowText()).toContain("Full mode ETA: 01:10");
  });

  it("shows a cooldown message instead of 00:00 when full-mode detail loading is still running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));

    const runtimeSendMessage = vi.fn(
      (
        _message: Record<string, unknown>,
        callback?: (response: Record<string, unknown> | undefined) => void,
      ) => {
        callback?.({
          ok: true,
          session: {
            session_id: "session-1",
            source: "tbank_web",
            app_origin: "http://localhost:3000",
            parse_strategy: "full",
            show_source_page_widget: true,
          },
        });
      },
    );

    const widget = createSourcePageWidget({
      runtimeSendMessage,
      addRuntimeListener: vi.fn(),
      removeRuntimeListener: vi.fn(),
    });
    widget.mount();

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_enriching_operations",
      progress_percent: 52,
      parsed_transactions_count: 277,
      estimated_total_ms: 35000,
      estimated_remaining_ms: 35000,
      estimate_updated_at: "2026-03-10T00:00:00.000Z",
      estimated_receipt_request_count: 97,
    });

    vi.advanceTimersByTime(8000);
    vi.setSystemTime(new Date("2026-03-10T00:00:08.000Z"));

    expect(getShadowText()).not.toContain("Full mode ETA: 00:00");
    expect(getShadowText()).toContain("Full mode ETA: 00:27");
    expect(getShadowText()).toContain("Receipt detail requests: 97");
  });

  it("keeps showing a countdown while finalizing after receipt loading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));

    const runtimeSendMessage = vi.fn(
      (
        _message: Record<string, unknown>,
        callback?: (response: Record<string, unknown> | undefined) => void,
      ) => {
        callback?.({
          ok: true,
          session: {
            session_id: "session-1",
            source: "tbank_web",
            app_origin: "http://localhost:3000",
            parse_strategy: "full",
            show_source_page_widget: true,
          },
        });
      },
    );

    const widget = createSourcePageWidget({
      runtimeSendMessage,
      addRuntimeListener: vi.fn(),
      removeRuntimeListener: vi.fn(),
    });
    widget.mount();

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "parse_enriching_operations",
      progress_percent: 52,
      estimated_total_ms: 35000,
      estimated_remaining_ms: 35000,
      estimate_updated_at: "2026-03-10T00:00:00.000Z",
      estimated_receipt_request_count: 97,
    });

    vi.advanceTimersByTime(8000);
    vi.setSystemTime(new Date("2026-03-10T00:00:08.000Z"));

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_PROGRESS",
      phase: "complete_session_started",
      progress_percent: 93,
    });

    expect(getShadowText()).not.toContain("Full mode ETA: 00:00");
    expect(getShadowText()).toContain("Full mode ETA: 00:27");
    expect(getShadowText()).toContain("Receipt detail requests: 97");
  });

  it("shows error and supports retry after MONEY_IMPORT_ERROR", () => {
    const { widget, runtimeSendMessage } = createHarness();
    widget.mount();

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_ERROR",
      error: "network failed",
    });
    expect(getShadowText()).toContain("network failed");

    const retryButton = getWidgetShadowRoot().querySelector(
      '[data-testid="money-import-overlay-retry-button"]',
    ) as HTMLButtonElement | null;
    expect(retryButton).not.toBeNull();
    retryButton?.click();

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MONEY_IMPORT_RUN",
        origin: "source_page_overlay",
      }),
      expect.any(Function),
    );
  });

  it("refreshes session via MONEY_IMPORT_SESSION_UPDATED and unmounts cleanly", () => {
    const { widget, addRuntimeListener, removeRuntimeListener } = createHarness();
    widget.mount();

    widget.handleRuntimeMessage({
      type: "MONEY_IMPORT_SESSION_UPDATED",
      session: {
        session_id: "session-2",
        source: "alfa_web",
        show_source_page_widget: true,
      },
    });

    expect(getShadowText()).toContain("session-2");
    expect(addRuntimeListener).toHaveBeenCalledTimes(1);

    widget.unmount();
    expect(removeRuntimeListener).toHaveBeenCalledTimes(1);
  });

  it("hydrates active import state from MONEY_IMPORT_GET_SESSION response after remount", () => {
    const runtimeSendMessage = vi.fn(
      (
        message: Record<string, unknown>,
        callback?: (response: Record<string, unknown> | undefined) => void,
      ) => {
        if (message.type === "MONEY_IMPORT_GET_SESSION") {
          callback?.({
            ok: true,
            session: {
              session_id: "session-1",
              source: "alfa_web",
              app_origin: "http://localhost:3000",
              batch_id: "batch-123",
              show_source_page_widget: true,
            },
            active_run: {
              running: true,
              phase: "parse_completed",
              progress_percent: 40,
              parsed_transactions_count: 13,
              batch_id: "batch-123",
            },
          });
          return;
        }
        callback?.({ ok: true });
      },
    );

    const widget = createSourcePageWidget({
      runtimeSendMessage,
      addRuntimeListener: vi.fn(),
      removeRuntimeListener: vi.fn(),
    });

    widget.mount();

    const runButton = getWidgetShadowRoot().querySelector(
      '[data-testid="money-import-overlay-run-button"]',
    ) as HTMLButtonElement | null;

    expect(getShadowText()).toContain("Import is running");
    expect(getShadowText()).toContain("40%");
    expect(getShadowText()).toContain("13");
    expect(getShadowText()).toContain("batch-123");
    expect(runButton?.disabled).toBe(true);
  });

  it("removes itself when no webapp-started source-page session is active", () => {
    const runtimeSendMessage = vi.fn(
      (
        _message: Record<string, unknown>,
        callback?: (response: Record<string, unknown> | undefined) => void,
      ) => {
        callback?.({
          ok: true,
          session: {
            session_id: "session-1",
            source: "tbank_web",
            app_origin: "http://localhost:3000",
          },
        });
      },
    );

    const widget = createSourcePageWidget({
      runtimeSendMessage,
      addRuntimeListener: vi.fn(),
      removeRuntimeListener: vi.fn(),
    });

    widget.mount();

    expect(document.getElementById("orbit-money-import-widget-root")).toBeNull();
  });
});
