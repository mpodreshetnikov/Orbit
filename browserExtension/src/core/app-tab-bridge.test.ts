import { describe, expect, it, vi } from "vitest";
import { reconnectAppTabs } from "./app-tab-bridge.js";
import { CONTENT_BRIDGE_PROBE } from "./content-bridge.js";

describe("reconnectAppTabs", () => {
  it("injects only the tabs where no live bridge answers the probe", async () => {
    const sendToTab = vi.fn(async (tabId: number) => {
      if (tabId === 1) return { alive: true };
      if (tabId === 2)
        throw new Error("Could not establish connection. Receiving end does not exist.");
      return undefined;
    });
    const injectContentScript = vi.fn(async (_tabId: number) => undefined);

    const injected = await reconnectAppTabs({
      queryAppTabs: async () => [{ id: 3 }, { id: 1 }, { id: 2 }, {}],
      sendToTab,
      injectContentScript,
    });

    expect(sendToTab).toHaveBeenCalledWith(1, { type: CONTENT_BRIDGE_PROBE });
    expect(sendToTab).toHaveBeenCalledTimes(3);
    expect(injectContentScript.mock.calls.map(([tabId]) => tabId).sort()).toEqual([2, 3]);
    expect(injected).toEqual([2, 3]);
  });

  it("leaves a tab that refuses the script and goes on with the rest", async () => {
    const injectContentScript = vi.fn(async (tabId: number) => {
      if (tabId === 4) throw new Error("Cannot access contents of the page.");
    });

    const injected = await reconnectAppTabs({
      queryAppTabs: async () => [{ id: 4 }, { id: 5 }],
      sendToTab: async () => {
        throw new Error("Receiving end does not exist.");
      },
      injectContentScript,
    });

    expect(injectContentScript).toHaveBeenCalledTimes(2);
    expect(injected).toEqual([5]);
  });
});
