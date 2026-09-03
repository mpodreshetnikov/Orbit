import { describe, expect, it } from "vitest";
import {
  createAttentionRefresher,
  isAppOriginAllowed,
  type AttentionRefresherDeps,
} from "./attention-refresh";
import { createAttentionStore } from "./attention-store";
import { DAY_MS, HOUR_MS } from "./attention-policy";
import { createInitialAutoRunState, nextAutoRunState, type AutoRunState } from "./auto-run-policy";
import type { StoredImportGrant } from "./grant-store";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");

function createStorage() {
  const values: Record<string, unknown> = {};
  return {
    async get(keys: string[]) {
      return Object.fromEntries(keys.map((key) => [key, values[key]]));
    },
    async set(next: Record<string, unknown>) {
      Object.assign(values, next);
    },
  };
}

function createHarness(
  options: {
    grant?: StoredImportGrant | null;
    states?: Record<string, AutoRunState>;
    openPage?: AttentionRefresherDeps["openPage"];
    allowedAppOrigins?: string[];
    activeSession?: boolean;
  } = {},
) {
  const grant =
    options.grant === undefined
      ? {
          token: "grant-token",
          person_id: "person-1",
          allowed_sources: ["tbank_web"],
          function_url: "https://project.supabase.co/functions/v1/money-import",
          app_origin: "https://app.example.com",
          received_at: new Date(NOW - 3 * DAY_MS).toISOString(),
        }
      : options.grant;
  const states = options.states ?? {};
  const badges: number[] = [];
  const opened: string[] = [];
  const events: string[] = [];
  const warnings: Array<Record<string, unknown>> = [];
  const attentionStore = createAttentionStore(createStorage());
  const deps: AttentionRefresherDeps = {
    grantStore: { getGrant: async () => grant, setGrant: async () => {} },
    autoRunStore: {
      getState: async (scope) =>
        states[`${scope.sourceId}::${scope.payerPersonId}`] ?? createInitialAutoRunState(),
      setState: async () => {},
      forgiveFailures: async () => 0,
    },
    attentionStore,
    listSourceIds: () => ["tbank_web"],
    allowedAppOrigins: () => options.allowedAppOrigins ?? ["https://app.example.com"],
    setBadge: async (count) => {
      badges.push(count);
    },
    hasActiveSession: async () => options.activeSession ?? false,
    openPage:
      options.openPage ??
      (async (url) => {
        opened.push(url);
      }),
    now: () => NOW,
    onInfo: (event) => events.push(event),
    onWarning: (_event, attrs) => warnings.push(attrs),
  };
  return {
    refresher: createAttentionRefresher(deps),
    attentionStore,
    badges,
    opened,
    events,
    warnings,
  };
}

describe("createAttentionRefresher", () => {
  it("puts the stale count on the badge and opens the page once", async () => {
    const harness = createHarness();

    await harness.refresher.refresh("startup", { mayOpenPage: true });

    expect(harness.badges).toEqual([1]);
    expect(harness.opened).toEqual(["https://app.example.com/money/import/attention"]);
    expect((await harness.attentionStore.getState()).lastOpenedAtMs).toBe(NOW);
    expect(harness.events).toEqual(["money_import_attention_page_opened"]);

    // Within the day: the badge again, the page not.
    await harness.refresher.refresh("alarm", { mayOpenPage: true });
    expect(harness.badges).toEqual([1, 1]);
    expect(harness.opened).toHaveLength(1);
  });

  it("opens one page when two refreshes land together", async () => {
    const harness = createHarness();

    await Promise.all([
      harness.refresher.refresh("startup", { mayOpenPage: true }),
      harness.refresher.refresh("alarm", { mayOpenPage: true }),
    ]);

    expect(harness.opened).toHaveLength(1);
  });

  it("only draws the badge when opening is not allowed", async () => {
    const harness = createHarness();

    await harness.refresher.refresh("visit", { mayOpenPage: false });

    expect(harness.badges).toEqual([1]);
    expect(harness.opened).toEqual([]);
  });

  it("clears the badge for a fresh source and opens nothing", async () => {
    const harness = createHarness({
      states: { "tbank_web::person-1": nextAutoRunState(null, NOW - 2 * HOUR_MS, "ok") },
    });

    await harness.refresher.refresh("alarm", { mayOpenPage: true });

    expect(harness.badges).toEqual([0]);
    expect(harness.opened).toEqual([]);
  });

  it("shows nothing without a grant", async () => {
    const harness = createHarness({ grant: null });

    await harness.refresher.refresh("startup", { mayOpenPage: true });

    expect(harness.badges).toEqual([0]);
    expect(harness.opened).toEqual([]);
  });

  it("draws the badge but opens no page over a run the person started", async () => {
    const harness = createHarness({ activeSession: true });

    await harness.refresher.refresh("alarm", { mayOpenPage: true });

    expect(harness.badges).toEqual([1]);
    expect(harness.opened).toEqual([]);
  });

  it("does not follow a grant to an origin that is not the app's", async () => {
    const harness = createHarness({ allowedAppOrigins: ["https://app.example.com:8443"] });

    await harness.refresher.refresh("startup", { mayOpenPage: true });

    expect(harness.badges).toEqual([1]);
    expect(harness.opened).toEqual([]);
    expect(harness.warnings).toEqual([{ reason: "startup" }]);
  });

  it("survives a page that will not open, and says so", async () => {
    const harness = createHarness({
      openPage: async () => {
        throw new Error("no window");
      },
    });

    await harness.refresher.refresh("startup", { mayOpenPage: true });

    expect(harness.badges).toEqual([1]);
    expect(harness.warnings).toEqual([{ reason: "startup", error_message: "no window" }]);
    // A later refresh still works: the queue is not stuck on the failure.
    await harness.refresher.refresh("alarm", { mayOpenPage: false });
    expect(harness.badges).toEqual([1, 1]);
  });
});

describe("isAppOriginAllowed", () => {
  it("compares origins, not strings", () => {
    const allowed = ["https://app.example.com/", "http://localhost:3000"];
    expect(isAppOriginAllowed("https://app.example.com", allowed)).toBe(true);
    expect(isAppOriginAllowed("https://app.example.com/money/import", allowed)).toBe(true);
    expect(isAppOriginAllowed("http://localhost:3000/", allowed)).toBe(true);
    expect(isAppOriginAllowed("http://app.example.com", allowed)).toBe(false);
    expect(isAppOriginAllowed("https://app.example.com.evil.example", allowed)).toBe(false);
    expect(isAppOriginAllowed("https://evil.example/app.example.com", allowed)).toBe(false);
    expect(isAppOriginAllowed("not a url", allowed)).toBe(false);
    expect(isAppOriginAllowed("https://app.example.com", ["garbage"])).toBe(false);
  });
});
