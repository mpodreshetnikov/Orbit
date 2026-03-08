// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createContentBridge } from "./content-bridge.js";

describe("content-bridge", () => {
  it("relays ping from window to runtime and sends pong", () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({ ok: true });
    });
    const windowPostMessage = vi.fn();
    const bridge = createContentBridge({
      runtimeSendMessage,
      windowPostMessage,
      nowMs: () => 123,
    });

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "orbit-webapp",
          type: "MONEY_IMPORT_PING",
        },
      }),
    );

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      { type: "MONEY_IMPORT_PING" },
      expect.any(Function),
    );
    expect(windowPostMessage).toHaveBeenCalledWith(
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_PONG",
        ts: 123,
      },
      "*",
    );
  });

  it("acks start session and forwards runtime status messages", () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({ ok: true });
    });
    const windowPostMessage = vi.fn();
    const bridge = createContentBridge({
      runtimeSendMessage,
      windowPostMessage,
    });

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "orbit-webapp",
          type: "MONEY_IMPORT_START_SESSION",
          session: { source: "tbank_web" },
        },
      }),
    );
    bridge.handleRuntimeMessage({
      type: "MONEY_IMPORT_DONE",
      batch_id: "batch-1",
    });

    expect(windowPostMessage).toHaveBeenNthCalledWith(
      1,
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_SESSION_ACK",
        ok: true,
      },
      "*",
    );
    expect(windowPostMessage).toHaveBeenNthCalledWith(
      2,
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_DONE",
        batch_id: "batch-1",
      },
      "*",
    );
  });

  it("forwards debug status and ignores unknown runtime messages", () => {
    const runtimeSendMessage = vi.fn();
    const windowPostMessage = vi.fn();
    const bridge = createContentBridge({
      runtimeSendMessage,
      windowPostMessage,
    });

    bridge.handleRuntimeMessage({
      type: "MONEY_IMPORT_DEBUG_STATUS",
      phase: "started",
      debug_run_id: "dbg-1",
    });
    bridge.handleRuntimeMessage({
      type: "MONEY_IMPORT_UNKNOWN_EVENT",
    });

    expect(windowPostMessage).toHaveBeenCalledTimes(1);
    expect(windowPostMessage).toHaveBeenCalledWith(
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_DEBUG_STATUS",
        phase: "started",
        debug_run_id: "dbg-1",
      },
      "*",
    );
  });

  it("ignores window messages from foreign source", () => {
    const runtimeSendMessage = vi.fn();
    const windowPostMessage = vi.fn();
    const bridge = createContentBridge({
      runtimeSendMessage,
      windowPostMessage,
    });

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "foreign-webapp",
          type: "MONEY_IMPORT_PING",
        },
      }),
    );

    expect(runtimeSendMessage).not.toHaveBeenCalled();
    expect(windowPostMessage).not.toHaveBeenCalled();
  });
});
