import type { LocalStorageLike } from "./session-store.js";
import {
  findMoneyImportSourceBySiteUrl,
  findMoneyImportSourceSiteOrigin,
  moveMoneyImportSourceUrl,
} from "../money-import-sources.js";

const PREFERRED_ORIGIN_STORAGE_KEY = "money_import_preferred_site_origin";

/**
 * How long a bank page may stay loading before its tab is moved to the bank's other site. T-Bank
 * on a slow day, or behind a VPN, took long enough that the run gave up on the tab while its
 * mirror answered at once (2026-10-26).
 */
export const SLOW_LOAD_FALLBACK_MS = 20_000;

/**
 * Which of a bank's sites last finished loading, per source. Tabs the extension opens for that
 * bank start there, so a domain that has been slow is not waited on again every run.
 */
export interface PreferredSiteOriginStore {
  get(sourceId: string): Promise<string | null>;
  set(sourceId: string, origin: string): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function createPreferredSiteOriginStore(
  storage: LocalStorageLike,
): PreferredSiteOriginStore {
  return {
    async get(sourceId) {
      const data = await storage.get([PREFERRED_ORIGIN_STORAGE_KEY]);
      const value = asRecord(data[PREFERRED_ORIGIN_STORAGE_KEY])[sourceId];
      return typeof value === "string" ? value : null;
    },
    async set(sourceId, origin) {
      const data = await storage.get([PREFERRED_ORIGIN_STORAGE_KEY]);
      const bySource = asRecord(data[PREFERRED_ORIGIN_STORAGE_KEY]);
      if (bySource[sourceId] === origin) return;
      await storage.set({ [PREFERRED_ORIGIN_STORAGE_KEY]: { ...bySource, [sourceId]: origin } });
    },
  };
}

/** A bank URL the extension is about to open, moved to the site that last worked for that bank. */
export async function toPreferredSiteUrl(
  store: PreferredSiteOriginStore,
  url: string,
): Promise<string> {
  const source = findMoneyImportSourceBySiteUrl(url);
  if (!source) return url;
  const preferred = await store.get(source.sourceId).catch(() => null);
  if (!preferred || !source.siteOrigins.includes(preferred)) return url;
  return moveMoneyImportSourceUrl(source.sourceId, url, preferred) ?? url;
}

export interface SlowLoadFallbackDeps {
  store: PreferredSiteOriginStore;
  /** Whether a tab is one an import depends on; a person's own browsing is left alone. */
  isWatchedTab: (tabId: number, sourceId: string) => Promise<boolean>;
  getTab: (tabId: number) => Promise<{ url?: string; status?: string } | null>;
  /**
   * Whether a loaded tab shows the browser's own error page: a site that could not be reached at
   * all ends there, as finished as a page that worked.
   */
  isErrorPage: (tabId: number) => Promise<boolean>;
  navigate: (tabId: number, url: string) => Promise<void>;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  delayMs?: number;
  onSwitched?: (attrs: Record<string, unknown>) => void;
}

export interface SlowLoadFallback {
  /** A tab started loading, or finished, on a URL; anything else about it is ignored. */
  onTabUpdated(tabId: number, status: string | undefined, url: string | undefined): Promise<void>;
  onTabRemoved(tabId: number): void;
}

/**
 * Moves a watched bank tab that is still loading after `delayMs`, or that finished on the
 * browser's error page, to the same page on the bank's other site, once per tab: a tab moved and slow on the mirror too is waited out rather than sent
 * back and forth. A finished load on a watched tab records its site as the one to start on next
 * time, so a mirror that worked is where the next run begins, and the primary is tried again only
 * when the mirror is the slow one.
 */
export function createSlowLoadFallback(deps: SlowLoadFallbackDeps): SlowLoadFallback {
  const delayMs = deps.delayMs ?? SLOW_LOAD_FALLBACK_MS;
  const timers = new Map<number, unknown>();
  const moved = new Set<number>();

  function cancel(tabId: number): void {
    const handle = timers.get(tabId);
    if (handle === undefined) return;
    deps.clearTimer(handle);
    timers.delete(tabId);
  }

  async function move(
    tabId: number,
    sourceId: string,
    url: string,
    reason: "slow" | "error_page",
  ): Promise<void> {
    if (moved.has(tabId)) return;
    const origin = findMoneyImportSourceSiteOrigin(sourceId, url);
    const target = moveMoneyImportSourceUrl(sourceId, url);
    if (!origin || !target) return;
    moved.add(tabId);
    await deps.navigate(tabId, target);
    deps.onSwitched?.({
      source_id: sourceId,
      from_origin: origin,
      to_origin: new URL(target).origin,
      reason,
      ...(reason === "slow" ? { after_ms: delayMs } : {}),
    });
  }

  async function fire(tabId: number, sourceId: string, loadingUrl: string): Promise<void> {
    timers.delete(tabId);
    const tab = await deps.getTab(tabId).catch(() => null);
    if (!tab || tab.status !== "loading") return;
    if (!(await deps.isWatchedTab(tabId, sourceId))) return;
    // Judged on the site, not the URL: the bank redirects within itself while it loads.
    const url = tab.url ?? loadingUrl;
    const origin = findMoneyImportSourceSiteOrigin(sourceId, url);
    if (!origin || origin !== findMoneyImportSourceSiteOrigin(sourceId, loadingUrl)) return;
    await move(tabId, sourceId, url, "slow");
  }

  return {
    async onTabUpdated(tabId, status, url) {
      if (status !== "loading" && status !== "complete") return;
      const source = findMoneyImportSourceBySiteUrl(url);
      if (!source || !url) {
        // Left the bank's sites, or landed on a sub-domain such as its sign-in: no timer runs
        // for a page that is not the one this watches.
        cancel(tabId);
        return;
      }
      if (status === "complete") {
        cancel(tabId);
        const origin = findMoneyImportSourceSiteOrigin(source.sourceId, url);
        if (!origin || !(await deps.isWatchedTab(tabId, source.sourceId))) return;
        // An unreachable site is a failure, not a site that worked: tried on the other one, and
        // never remembered as the one to start on.
        if (await deps.isErrorPage(tabId).catch(() => false)) {
          await move(tabId, source.sourceId, url, "error_page");
          return;
        }
        await deps.store.set(source.sourceId, origin).catch(() => undefined);
        return;
      }
      // Whether the tab is watched is asked when the delay is up, not now: the import page opens
      // the bank first and hands the extension its session after, so a tab that starts loading
      // unwatched is often watched by the time it is slow.
      if (moved.has(tabId) || timers.has(tabId) || source.siteOrigins.length < 2) return;
      timers.set(
        tabId,
        deps.setTimer(() => {
          void fire(tabId, source.sourceId, url).catch(() => undefined);
        }, delayMs),
      );
    },
    onTabRemoved(tabId) {
      cancel(tabId);
      moved.delete(tabId);
    },
  };
}
