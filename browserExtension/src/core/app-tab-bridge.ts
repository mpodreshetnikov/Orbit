import { CONTENT_BRIDGE_PROBE } from "./content-bridge.js";

export interface AppTabBridgeDeps {
  queryAppTabs: () => Promise<{ id?: number }[]>;
  /** Resolves with the tab's reply, or rejects when nothing in the tab listens. */
  sendToTab: (tabId: number, message: Record<string, unknown>) => Promise<unknown>;
  injectContentScript: (tabId: number) => Promise<void>;
}

function answeredAlive(response: unknown): boolean {
  return Boolean(response && typeof response === "object" && "alive" in response);
}

/**
 * Gives every open Orbit tab a content script of this version.
 *
 * Chrome injects manifest content scripts only into pages loaded after the extension is; a tab
 * open across an install or an update keeps no bridge, or the previous version's, whose every
 * call throws "Extension context invalidated". The page then never heard the extension until it
 * was reloaded -- after every self-update (2026-10-25). Firefox injects into open tabs by itself,
 * so a tab is injected only when no live bridge answers the probe. Returns the tabs injected.
 */
export async function reconnectAppTabs(deps: AppTabBridgeDeps): Promise<number[]> {
  const tabs = await deps.queryAppTabs();
  const injected: number[] = [];
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") return;
      const tabId = tab.id;
      const alive = await deps
        .sendToTab(tabId, { type: CONTENT_BRIDGE_PROBE })
        .then(answeredAlive, () => false);
      if (alive) return;
      // A tab that cannot take a script -- an error page, one closing -- is left as it is.
      await deps.injectContentScript(tabId).then(
        () => injected.push(tabId),
        () => undefined,
      );
    }),
  );
  return injected.sort((a, b) => a - b);
}
