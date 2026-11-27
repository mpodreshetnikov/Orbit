// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_BRIDGE_PROBE,
  claimContentBridge,
  createContentBridge,
  type ContentBridgeDeps,
} from "./content-bridge.js";

const pageMessages: unknown[] = [];
const pageBarrier = "content-bridge-test-drain";

function receivePageMessage(event: MessageEvent) {
  if (event.data !== pageBarrier) pageMessages.push(event.data);
}

beforeEach(() => {
  pageMessages.length = 0;
  window.addEventListener("message", receivePageMessage);
});

afterEach(() => {
  window.removeEventListener("message", receivePageMessage);
});

function readPageMessages(): Promise<unknown[]> {
  // Flush queued postMessage deliveries, including when no reply is expected.
  return new Promise((resolve) => {
    function finish(event: MessageEvent) {
      if (event.data !== pageBarrier) return;
      window.removeEventListener("message", finish);
      resolve([...pageMessages]);
    }
    window.addEventListener("message", finish);
    window.postMessage(pageBarrier, "*");
  });
}

const windowPostMessage: ContentBridgeDeps["windowPostMessage"] = (message, targetOrigin) =>
  window.postMessage(message, targetOrigin);

describe("content-bridge", () => {
  it("relays ping from window to runtime and sends pong", async () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({ ok: true, extension_id: "unit-test", extension_version: "0.1.1" });
    });
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
    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_PONG",
        ts: 123,
        extension_id: "unit-test",
        extension_version: "0.1.1",
      },
    ]);
  });

  it("acks start session and forwards runtime status messages", async () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({ ok: true });
    });
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

    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_SESSION_ACK",
        ok: true,
      },
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_DONE",
        batch_id: "batch-1",
      },
    ]);
  });

  it("forwards debug status and ignores unknown runtime messages", async () => {
    const runtimeSendMessage = vi.fn();
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

    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_DEBUG_STATUS",
        phase: "started",
        debug_run_id: "dbg-1",
      },
    ]);
  });

  it("ignores window messages from foreign source", async () => {
    const runtimeSendMessage = vi.fn();
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
    expect(await readPageMessages()).toEqual([]);
  });

  it("relays the auto-import status request and answers with what came back", async () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({
        ok: true,
        grant: { person_id: "person-1", allowed_sources: ["tbank_web"], received_at: "x" },
        sources: [{ source_id: "tbank_web", next_run: { kind: "now" } }],
      });
    });
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
    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_AUTO_STATUS",
        request_id: "r-7",
        ok: true,
        grant: { person_id: "person-1", allowed_sources: ["tbank_web"], received_at: "x" },
        sources: [{ source_id: "tbank_web", next_run: { kind: "now" } }],
        schedule: null,
      },
    ]);
  });
});

describe("attention page requests", () => {
  function createBridge() {
    const runtimeSendMessage = vi.fn();
    const bridge = createContentBridge({ runtimeSendMessage, windowPostMessage, nowMs: () => 1 });
    return { bridge, runtimeSendMessage };
  }

  it("relays the attention request and answers with what came back, request id echoed", async () => {
    const { bridge, runtimeSendMessage } = createBridge();
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
    expect(await readPageMessages()).toEqual([
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
    ]);
  });

  it("relays a run request with its source and acks the answer", async () => {
    const { bridge, runtimeSendMessage } = createBridge();
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
    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_RUN_REQUEST_ACK",
        request_id: "r-1",
        ok: false,
        error: "No import grant",
        source_id: null,
      },
    ]);
  });

  it("relays the threshold and acks what was stored", async () => {
    const { bridge, runtimeSendMessage } = createBridge();
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
    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_ATTENTION_SETTINGS_ACK",
        request_id: "s-1",
        ok: true,
        stale_after_ms: 259_200_000,
      },
    ]);
  });

  it("relays the schedule and acks what was stored", async () => {
    const { bridge, runtimeSendMessage } = createBridge();
    runtimeSendMessage.mockImplementation((_message, callback) =>
      callback?.({ ok: true, schedule: { kind: "month", at: "end" } } as never),
    );

    bridge.handleWindowMessage(
      new MessageEvent("message", {
        source: window as unknown as MessageEventSource,
        data: {
          source: "orbit-webapp",
          type: "MONEY_IMPORT_SET_AUTO_SCHEDULE",
          request_id: "s-2",
          schedule: { kind: "month", at: "end" },
        },
      }),
    );

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      { type: "MONEY_IMPORT_SET_AUTO_SCHEDULE", schedule: { kind: "month", at: "end" } },
      expect.any(Function),
    );
    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_AUTO_SCHEDULE_ACK",
        request_id: "s-2",
        ok: true,
        schedule: { kind: "month", at: "end" },
      },
    ]);
  });

  it("tells the page the bridge is dead when the runtime throws, instead of throwing", async () => {
    // What a content script does after the extension updated under its tab.
    const runtimeSendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });
    const onWarning = vi.fn();
    const bridge = createContentBridge({
      runtimeSendMessage,
      windowPostMessage,
      nowMs: () => 5,
      onWarning,
    });

    expect(() =>
      bridge.handleWindowMessage(
        new MessageEvent("message", {
          source: window,
          data: { source: "orbit-webapp", type: "MONEY_IMPORT_PING" },
        }),
      ),
    ).not.toThrow();

    // Said before it is handled: the page shows no reason.
    expect(onWarning).toHaveBeenCalledWith("money_import_bridge_send_failed", {
      message_type: "MONEY_IMPORT_PING",
      error_message: "Extension context invalidated.",
    });
    expect(await readPageMessages()).toEqual([
      {
        source: "orbit-extension",
        type: "MONEY_IMPORT_BRIDGE_STALE",
        ts: 5,
        reason: "Extension context invalidated.",
      },
    ]);
  });

  it("answers the background's probe and tells the page nothing", async () => {
    const bridge = createContentBridge({ runtimeSendMessage: vi.fn(), windowPostMessage });
    const replies: unknown[] = [];
    bridge.handleRuntimeMessage({ type: CONTENT_BRIDGE_PROBE }, {}, (response) => {
      replies.push(response);
    });

    expect(replies).toEqual([{ alive: true }]);
    expect(await readPageMessages()).toEqual([]);
  });

  it("lets only the first injection in a world install the bridge", () => {
    const scope: Record<string, unknown> = {};
    expect(claimContentBridge(scope)).toBe(true);
    expect(claimContentBridge(scope)).toBe(false);
    expect(claimContentBridge({})).toBe(true);
  });
});
