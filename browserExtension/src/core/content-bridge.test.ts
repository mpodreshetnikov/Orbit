// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createContentBridge } from "./content-bridge.js";

describe("content-bridge", () => {
  it("relays ping from window to runtime and sends pong", () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({ ok: true, extension_id: "unit-test", extension_version: "0.1.1" });
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
        extension_id: "unit-test",
        extension_version: "0.1.1",
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

  it("relays the auto-import status request and answers with what came back", () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({
        ok: true,
        grant: { person_id: "person-1", allowed_sources: ["tbank_web"], received_at: "x" },
        sources: [{ source_id: "tbank_web", next_run: { kind: "now" } }],
      });
    });
    const windowPostMessage = vi.fn();
    const bridge = createContentBridge({ runtimeSendMessage, windowPostMessage });

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window,
        data: { source: "orbit-webapp", type: "MONEY_IMPORT_GET_AUTO_STATUS", request_id: "r-7" },
      }),
    );

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      { type: "MONEY_IMPORT_GET_AUTO_STATUS" },
      expect.any(Function),
    );
    expect(windowPostMessage).toHaveBeenCalledWith(
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_AUTO_STATUS",
        request_id: "r-7",
        ok: true,
        grant: { person_id: "person-1", allowed_sources: ["tbank_web"], received_at: "x" },
        sources: [{ source_id: "tbank_web", next_run: { kind: "now" } }],
      },
      "*",
    );
  });
});

describe("attention page requests", () => {
  function createBridge() {
    const runtimeSendMessage = vi.fn();
    const windowPostMessage = vi.fn();
    const bridge = createContentBridge({ runtimeSendMessage, windowPostMessage, nowMs: () => 1 });
    return { bridge, runtimeSendMessage, windowPostMessage };
  }

  it("relays the attention request and answers with what came back, request id echoed", () => {
    const { bridge, runtimeSendMessage, windowPostMessage } = createBridge();
    runtimeSendMessage.mockImplementation((_message, callback) =>
      callback?.({
        ok: true,
        grant: { person_id: "person-1", allowed_sources: ["tbank_web"], received_at: "x" },
        stale_after_ms: 86_400_000,
        stale_count: 1,
        sources: [{ source_id: "tbank_web", stale: true }],
      } as never),
    );

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window as unknown as MessageEventSource,
        data: { source: "orbit-webapp", type: "MONEY_IMPORT_GET_ATTENTION", request_id: "a-1" },
      }),
    );

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      { type: "MONEY_IMPORT_GET_ATTENTION" },
      expect.any(Function),
    );
    expect(windowPostMessage).toHaveBeenCalledWith(
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_ATTENTION",
        request_id: "a-1",
        ok: true,
        grant: { person_id: "person-1", allowed_sources: ["tbank_web"], received_at: "x" },
        stale_after_ms: 86_400_000,
        stale_count: 1,
        sources: [{ source_id: "tbank_web", stale: true }],
      },
      "*",
    );
  });

  it("relays a run request with its source and acks the answer", () => {
    const { bridge, runtimeSendMessage, windowPostMessage } = createBridge();
    runtimeSendMessage.mockImplementation((_message, callback) =>
      callback?.({ ok: false, error: "No import grant" } as never),
    );

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window as unknown as MessageEventSource,
        data: {
          source: "orbit-webapp",
          type: "MONEY_IMPORT_REQUEST_RUN",
          request_id: "r-1",
          source_id: "tbank_web",
        },
      }),
    );

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      { type: "MONEY_IMPORT_REQUEST_RUN", source_id: "tbank_web" },
      expect.any(Function),
    );
    expect(windowPostMessage).toHaveBeenCalledWith(
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_RUN_REQUEST_ACK",
        request_id: "r-1",
        ok: false,
        error: "No import grant",
        source_id: null,
      },
      "*",
    );
  });

  it("relays the threshold and acks what was stored", () => {
    const { bridge, runtimeSendMessage, windowPostMessage } = createBridge();
    runtimeSendMessage.mockImplementation((_message, callback) =>
      callback?.({ ok: true, stale_after_ms: 259_200_000 } as never),
    );

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window as unknown as MessageEventSource,
        data: {
          source: "orbit-webapp",
          type: "MONEY_IMPORT_SET_ATTENTION_SETTINGS",
          request_id: "s-1",
          stale_after_ms: 259_200_000,
        },
      }),
    );

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      { type: "MONEY_IMPORT_SET_ATTENTION_SETTINGS", stale_after_ms: 259_200_000 },
      expect.any(Function),
    );
    expect(windowPostMessage).toHaveBeenCalledWith(
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_ATTENTION_SETTINGS_ACK",
        request_id: "s-1",
        ok: true,
        stale_after_ms: 259_200_000,
      },
      "*",
    );
  });
});
