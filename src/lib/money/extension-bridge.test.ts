// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { probeExtension } from "./extension-bridge";

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
