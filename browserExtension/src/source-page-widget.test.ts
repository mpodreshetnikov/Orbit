// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcePageWidget } from "./source-page-widget.js";

describe("source-page-widget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function getWidgetShadowRoot(): ShadowRoot {
    const host = document.getElementById(
      "orbit-money-import-widget-root",
    ) as HTMLDivElement | null;
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
            source: "tbank_web",
            app_origin: "http://localhost:3000",
          },
        });
      },
    );
    const addRuntimeListener = vi.fn();
    const removeRuntimeListener = vi.fn();
    const widget = createSourcePageWidget({
      runtimeSendMessage,
      addRuntimeListener,
      removeRuntimeListener,
    });
    return {
      widget,
      runtimeSendMessage,
      addRuntimeListener,
      removeRuntimeListener,
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
        source: "tbank_web",
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
              source: "tbank_web",
              app_origin: "http://localhost:3000",
              batch_id: "batch-123",
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
});
