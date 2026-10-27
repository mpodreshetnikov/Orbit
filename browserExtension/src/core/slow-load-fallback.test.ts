import { describe, expect, it } from "vitest";
import {
  createMovedTabStore,
  createPreferredSiteOriginStore,
  isSessionTab,
  createSlowLoadFallback,
  toPreferredSiteUrl,
  type SlowLoadFallbackDeps,
} from "./slow-load-fallback.js";
import type { LocalStorageLike } from "./session-store.js";

function memoryStorage(): LocalStorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values) {
      Object.assign(data, values);
    },
  };
}

function harness(options: {
  watched?: boolean;
  errorPage?: boolean;
  tab?: { url?: string; status?: string } | null;
  movedStorage?: LocalStorageLike;
}) {
  const store = createPreferredSiteOriginStore(memoryStorage());
  const moved = createMovedTabStore(options.movedStorage ?? memoryStorage());
  const timers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = [];
  const navigations: Array<{ tabId: number; url: string }> = [];
  const switches: Array<Record<string, unknown>> = [];
  let tab = options.tab ?? null;
  const deps: SlowLoadFallbackDeps = {
    store,
    moved,
    isWatchedTab: async () => options.watched ?? true,
    getTab: async () => tab,
    isErrorPage: async () => options.errorPage ?? false,
    navigate: async (tabId, url) => {
      navigations.push({ tabId, url });
    },
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    onSwitched: (attrs) => switches.push(attrs),
  };
  const fallback = createSlowLoadFallback(deps);
  return {
    fallback,
    store,
    timers,
    navigations,
    switches,
    setTab: (next: { url?: string; status?: string } | null) => {
      tab = next;
    },
    async fireAll() {
      for (const timer of timers.filter((entry) => !entry.cleared)) timer.callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const PRIMARY = "https://www.tbank.ru/mybank/operations/";
const MIRROR = "https://www.tbank-online.com/mybank/operations/";

describe("slow-load fallback", () => {
  it("moves a watched T-Bank tab still loading after the delay to the mirror", async () => {
    const h = harness({ tab: { url: PRIMARY, status: "loading" } });
    await h.fallback.onTabUpdated(7, "loading", PRIMARY);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.delayMs).toBe(20_000);

    await h.fireAll();
    expect(h.navigations).toEqual([{ tabId: 7, url: MIRROR }]);
    expect(h.switches[0]).toMatchObject({
      source_id: "tbank_web",
      from_origin: "https://www.tbank.ru",
      to_origin: "https://www.tbank-online.com",
    });
  });

  it("leaves a tab that finished loading in time, and remembers its site", async () => {
    const h = harness({ tab: { url: MIRROR, status: "complete" } });
    await h.fallback.onTabUpdated(7, "loading", MIRROR);
    await h.fallback.onTabUpdated(7, "complete", MIRROR);
    expect(h.timers[0]?.cleared).toBe(true);
    await h.fireAll();
    expect(h.navigations).toEqual([]);
    expect(await h.store.get("tbank_web")).toBe("https://www.tbank-online.com");
  });

  it("does not move a tab twice, so a slow mirror is waited out", async () => {
    const h = harness({ tab: { url: PRIMARY, status: "loading" } });
    await h.fallback.onTabUpdated(7, "loading", PRIMARY);
    await h.fireAll();
    h.setTab({ url: MIRROR, status: "loading" });
    await h.fallback.onTabUpdated(7, "loading", MIRROR);
    await h.fireAll();
    expect(h.navigations).toHaveLength(1);

    // A closed tab's id may come back for a new tab, which starts afresh.
    h.fallback.onTabRemoved(7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.fallback.onTabUpdated(7, "loading", MIRROR);
    await h.fireAll();
    expect(h.navigations.at(-1)).toEqual({ tabId: 7, url: PRIMARY });
  });

  it("moves a watched tab that could not reach the bank at once, and remembers nothing", async () => {
    const h = harness({ errorPage: true, tab: { url: PRIMARY, status: "complete" } });
    await h.fallback.onTabUpdated(7, "loading", PRIMARY);
    await h.fallback.onTabUpdated(7, "complete", PRIMARY);
    expect(h.navigations).toEqual([{ tabId: 7, url: MIRROR }]);
    expect(h.switches[0]).toMatchObject({ reason: "error_page" });
    expect(h.switches[0]).not.toHaveProperty("after_ms");
    expect(await h.store.get("tbank_web")).toBeNull();

    // The mirror unreachable too: the tab stays where it is.
    await h.fallback.onTabUpdated(7, "complete", MIRROR);
    expect(h.navigations).toHaveLength(1);
    expect(await h.store.get("tbank_web")).toBeNull();
  });

  it("remembers a moved tab across a restarted worker", async () => {
    const movedStorage = memoryStorage();
    const first = harness({ movedStorage, tab: { url: PRIMARY, status: "loading" } });
    await first.fallback.onTabUpdated(7, "loading", PRIMARY);
    await first.fireAll();
    expect(first.navigations).toHaveLength(1);

    const second = harness({
      movedStorage,
      errorPage: true,
      tab: { url: MIRROR, status: "complete" },
    });
    await second.fallback.onTabUpdated(7, "complete", MIRROR);
    await second.fallback.onTabUpdated(7, "loading", MIRROR);
    expect(second.navigations).toEqual([]);
    expect(second.timers).toHaveLength(0);
  });

  it("leaves tabs no import depends on alone", async () => {
    const h = harness({ watched: false, tab: { url: PRIMARY, status: "loading" } });
    await h.fallback.onTabUpdated(7, "loading", PRIMARY);
    await h.fireAll();
    expect(h.navigations).toEqual([]);
    await h.fallback.onTabUpdated(7, "complete", PRIMARY);
    expect(await h.store.get("tbank_web")).toBeNull();
  });

  it("does nothing when the tab has moved on by the time the delay passes", async () => {
    const h = harness({ tab: { url: "https://id.tbank.ru/auth/", status: "loading" } });
    await h.fallback.onTabUpdated(7, "loading", PRIMARY);
    await h.fireAll();
    expect(h.navigations).toEqual([]);
  });

  it("cancels the timer when the tab leaves the bank's sites", async () => {
    const h = harness({ tab: { url: PRIMARY, status: "loading" } });
    await h.fallback.onTabUpdated(7, "loading", PRIMARY);
    await h.fallback.onTabUpdated(7, "loading", "https://example.com/");
    expect(h.timers[0]?.cleared).toBe(true);
  });

  it("starts no timer for a bank with one site", async () => {
    const h = harness({ tab: { url: "https://web.alfabank.ru/", status: "loading" } });
    await h.fallback.onTabUpdated(7, "loading", "https://web.alfabank.ru/");
    expect(h.timers).toHaveLength(0);
  });

  it("ignores updates that are neither a load starting nor finishing", async () => {
    const h = harness({ tab: { url: PRIMARY, status: "loading" } });
    await h.fallback.onTabUpdated(7, undefined, PRIMARY);
    expect(h.timers).toHaveLength(0);
  });
});

describe("toPreferredSiteUrl", () => {
  it("opens the bank on the site that last worked", async () => {
    const store = createPreferredSiteOriginStore(memoryStorage());
    expect(await toPreferredSiteUrl(store, PRIMARY)).toBe(PRIMARY);
    await store.set("tbank_web", "https://www.tbank-online.com");
    expect(await toPreferredSiteUrl(store, PRIMARY)).toBe(MIRROR);
    expect(await toPreferredSiteUrl(store, "https://web.alfabank.ru/")).toBe(
      "https://web.alfabank.ru/",
    );
    expect(await toPreferredSiteUrl(store, "https://example.com/")).toBe("https://example.com/");
  });

  it("ignores a stored origin the bank does not serve", async () => {
    const store = createPreferredSiteOriginStore(memoryStorage());
    await store.set("tbank_web", "https://evil.example");
    expect(await toPreferredSiteUrl(store, PRIMARY)).toBe(PRIMARY);
  });
});

describe("isSessionTab", () => {
  const base = { tabId: 7, sourceId: "tbank_web", tabCreatedAtMs: 1_000, sessionSeenAtMs: 1_500 };

  it("takes the tab the run names once it has started, and no other", () => {
    const session = { source: "tbank_web", run_tab_id: 7 };
    expect(isSessionTab({ ...base, session })).toBe(true);
    expect(isSessionTab({ ...base, tabId: 8, session })).toBe(false);
  });

  it("before the run, takes only a tab created when the session arrived", () => {
    const session = { source: "tbank_web" };
    expect(isSessionTab({ ...base, session })).toBe(true);
    expect(isSessionTab({ ...base, session, tabCreatedAtMs: 1_500 + 16_000 })).toBe(false);
    expect(isSessionTab({ ...base, session, tabCreatedAtMs: null })).toBe(false);
    expect(isSessionTab({ ...base, session, sessionSeenAtMs: null })).toBe(false);
  });

  it("takes nothing for another bank's session, or none", () => {
    expect(isSessionTab({ ...base, session: { source: "alfa_web" } })).toBe(false);
    expect(isSessionTab({ ...base, session: null })).toBe(false);
  });
});

describe("createMovedTabStore", () => {
  it("adds, finds and forgets tabs", async () => {
    const moved = createMovedTabStore(memoryStorage());
    expect(await moved.has(1)).toBe(false);
    await moved.add(1);
    await moved.add(1);
    await moved.add(2);
    expect(await moved.has(1)).toBe(true);
    await moved.delete(1);
    await moved.delete(3);
    expect(await moved.has(1)).toBe(false);
    expect(await moved.has(2)).toBe(true);
  });
});
