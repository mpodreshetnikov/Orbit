// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  probeExtension,
  readImportAutoSchedule,
  setExtensionAutoSchedule,
} from "./extension-bridge";

function replyToPings(...types: string[]) {
  return vi.spyOn(window, "postMessage").mockImplementation((message) => {
    if ((message as { type?: string }).type !== "MONEY_IMPORT_PING") return;
    for (const type of types) {
      window.dispatchEvent(
        new MessageEvent("message", { data: { source: "orbit-extension", type } }),
      );
    }
  });
}

describe("probeExtension", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers a live answer over the stale notice of an orphaned script in the same tab", async () => {
    replyToPings("MONEY_IMPORT_BRIDGE_STALE", "MONEY_IMPORT_PONG");
    await expect(probeExtension(200)).resolves.toBe("alive");
  });

  it("is stale only when no live answer comes by the timeout", async () => {
    replyToPings("MONEY_IMPORT_BRIDGE_STALE");
    await expect(probeExtension(50)).resolves.toBe("stale");
  });

  it("is silent when nothing answers", async () => {
    replyToPings();
    await expect(probeExtension(50)).resolves.toBe("silent");
  });
});

describe("setExtensionAutoSchedule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function answerWith(reply: Record<string, unknown>) {
    return vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const request = message as { type?: string; request_id?: string };
      if (request.type !== "MONEY_IMPORT_SET_AUTO_SCHEDULE") return;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "orbit-extension",
            type: "MONEY_IMPORT_AUTO_SCHEDULE_ACK",
            request_id: request.request_id,
            ...reply,
          },
        }),
      );
    });
  }

  it("resolves with what the extension kept", async () => {
    const post = answerWith({ ok: true, schedule: { kind: "days", every: 30 } });
    await expect(setExtensionAutoSchedule({ kind: "days", every: 45 })).resolves.toEqual({
      kind: "days",
      every: 30,
    });
    expect(post.mock.calls[0]?.[0]).toMatchObject({ schedule: { kind: "days", every: 45 } });
  });

  it("resolves null when the extension refused", async () => {
    answerWith({ ok: false });
    await expect(setExtensionAutoSchedule({ kind: "week", at: "end" })).resolves.toBeNull();
  });
});

describe("readImportAutoSchedule", () => {
  it("reads the three shapes and nothing else", () => {
    expect(readImportAutoSchedule({ kind: "days", every: 2.4 })).toEqual({
      kind: "days",
      every: 2,
    });
    expect(readImportAutoSchedule({ kind: "month", at: "start" })).toEqual({
      kind: "month",
      at: "start",
    });
    expect(readImportAutoSchedule({ kind: "days", every: 0 })).toBeNull();
    expect(readImportAutoSchedule({ kind: "week", at: "noon" })).toBeNull();
    expect(readImportAutoSchedule("weekly")).toBeNull();
  });
});
