import { describe, expect, it, vi } from "vitest";
import { createAutoImportSweep, type AutoImportSweepDeps } from "./auto-import-sweep";
import { createInitialAutoRunState, type AutoRunState } from "./auto-run-policy";
import type { StoredImportGrant } from "./grant-store";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

function createGrant(overrides: Partial<StoredImportGrant> = {}): StoredImportGrant {
  return {
    token: "grant-token",
    person_id: "person-1",
    allowed_sources: ["tbank"],
    function_url: "https://project.supabase.co/functions/v1/money-import",
    app_origin: "https://app.example.com",
    received_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function createHarness(
  overrides: {
    grant?: StoredImportGrant | null;
    session?: Record<string, unknown> | null;
    states?: Record<string, AutoRunState>;
    runImport?: AutoImportSweepDeps["runImport"];
    openTab?: AutoImportSweepDeps["openTab"];
    waitForTabComplete?: AutoImportSweepDeps["waitForTabComplete"];
    sources?: AutoImportSweepDeps["listSources"];
  } = {},
) {
  const states: Record<string, AutoRunState> = { ...(overrides.states ?? {}) };
  let session = overrides.session ?? null;
  const openedTabs: string[] = [];
  const closedTabs: number[] = [];
  const warnings: Array<{ event: string; attrs: Record<string, unknown> }> = [];

  const openTab =
    overrides.openTab ??
    vi.fn(async (url: string) => {
      openedTabs.push(url);
      return 77;
    });

  let storedGrant: StoredImportGrant | null =
    overrides.grant === undefined ? createGrant() : overrides.grant;

  const deps: AutoImportSweepDeps = {
    listSources:
      overrides.sources ??
      (() => [{ sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" }]),
    grantStore: {
      getGrant: async () => storedGrant,
      setGrant: async (grant) => {
        storedGrant = grant;
      },
    },
    sessionStore: {
      getSession: async () => session,
      setSession: async (next) => {
        session = next;
      },
    },
    autoRunStore: {
      getState: async (scope) =>
        states[`${scope.sourceId}::${scope.payerPersonId}`] ?? createInitialAutoRunState(),
      setState: async (scope, state) => {
        states[`${scope.sourceId}::${scope.payerPersonId}`] = state;
      },
    },
    openTab,
    waitForTabComplete: overrides.waitForTabComplete ?? vi.fn(async () => true),
    closeTab: vi.fn(async (tabId: number) => {
      closedTabs.push(tabId);
    }),
    runImport: overrides.runImport ?? vi.fn(async () => ({ ok: true })),
    now: () => NOW,
    onWarning: (event, attrs) => warnings.push({ event, attrs }),
  };

  return {
    deps,
    states,
    openedTabs,
    closedTabs,
    warnings,
    sweep: createAutoImportSweep(deps),
    getSession: () => session,
    getGrant: () => storedGrant,
  };
}

describe("createAutoImportSweep", () => {
  it("imports in a tab it opens and closes, never a tab the person had", async () => {
    const harness = createHarness();
    await harness.sweep.run("visit");

    expect(harness.openedTabs).toEqual(["https://www.tbank.ru/mybank/operations/"]);
    expect(harness.closedTabs).toEqual([77]);
    expect(harness.deps.runImport).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "tbank", tabId: 77 }),
    );
    expect(harness.states["tbank::person-1"]).toEqual({
      lastRunAtMs: NOW,
      lastResult: "ok",
      consecutiveFailures: 0,
    });
  });

  it("closes its tab and clears the session when the run throws", async () => {
    const harness = createHarness({
      runImport: vi.fn(async () => {
        throw new Error("signed out");
      }),
    });
    await harness.sweep.run("visit");

    expect(harness.closedTabs).toEqual([77]);
    expect(harness.states["tbank::person-1"].consecutiveFailures).toBe(1);
    expect(harness.warnings[0]?.event).toBe("money_import_auto_run_failed");
  });

  it("counts a tab that never loads as a failure and still closes it", async () => {
    const harness = createHarness({ waitForTabComplete: vi.fn(async () => false) });
    await harness.sweep.run("alarm");

    expect(harness.deps.runImport).not.toHaveBeenCalled();
    expect(harness.closedTabs).toEqual([77]);
    expect(harness.states["tbank::person-1"].consecutiveFailures).toBe(1);
  });

  it("runs nothing without a grant", async () => {
    const harness = createHarness({ grant: null });
    await harness.sweep.run("visit");

    expect(harness.openedTabs).toEqual([]);
    expect(harness.deps.runImport).not.toHaveBeenCalled();
  });

  it("stands aside while a run the person started is in flight", async () => {
    const harness = createHarness({ session: { session_id: "manual-1" } });
    await harness.sweep.run("visit");

    expect(harness.openedTabs).toEqual([]);
    // The manual run's session is left exactly as it was found.
    expect(harness.getSession()).toEqual({ session_id: "manual-1" });
  });

  it("skips a source the grant does not cover", async () => {
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["alfabank"] }),
    });
    await harness.sweep.run("visit");

    expect(harness.openedTabs).toEqual([]);
  });

  it("respects the cooldown of a source that ran recently", async () => {
    const harness = createHarness({
      states: {
        "tbank::person-1": { lastRunAtMs: NOW - 1000, lastResult: "ok", consecutiveFailures: 0 },
      },
    });
    await harness.sweep.run("alarm");

    expect(harness.openedTabs).toEqual([]);
  });

  it("refuses to start a second sweep while one is running", async () => {
    let releaseRun: () => void = () => {};
    const started = vi.fn();
    const harness = createHarness({
      runImport: vi.fn(async () => {
        started();
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        return { ok: true };
      }),
    });

    const first = harness.sweep.run("visit");
    // Let the first sweep reach the point where it is waiting on the import.
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1));

    // This is the shape of the real race: opening a tab is a navigation, and navigation is what
    // triggers a sweep. Without the guard the second one would open a second tab against the
    // same bank.
    await harness.sweep.run("visit");
    expect(harness.openedTabs).toHaveLength(1);

    releaseRun();
    await first;
    expect(harness.openedTabs).toHaveLength(1);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("takes each covered source in turn", async () => {
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank", "alfabank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
    });
    await harness.sweep.run("alarm");

    expect(harness.openedTabs).toEqual([
      "https://www.tbank.ru/mybank/operations/",
      "https://web.alfabank.ru/",
    ]);
    expect(harness.states["tbank::person-1"].lastResult).toBe("ok");
    expect(harness.states["alfabank::person-1"].lastResult).toBe("ok");
  });

  it("lets a later source run after an earlier one fails", async () => {
    const runImport = vi
      .fn()
      .mockRejectedValueOnce(new Error("signed out"))
      .mockResolvedValueOnce({ ok: true });
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank", "alfabank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
      runImport,
    });
    await harness.sweep.run("alarm");

    expect(runImport).toHaveBeenCalledTimes(2);
    expect(harness.states["tbank::person-1"].lastResult).toBe("error");
    expect(harness.states["alfabank::person-1"].lastResult).toBe("ok");
  });

  it("drops a grant the server has stopped accepting", async () => {
    const harness = createHarness({
      runImport: vi.fn(async () => {
        throw new Error("money-import responded 401 Unauthorized");
      }),
    });
    await harness.sweep.run("alarm");

    // Revocation happens in the app and never reaches the extension, so a refusal is the only
    // way it learns. Keeping the credential would mean opening bank tabs for doomed requests
    // until the backoff ran out.
    expect(harness.getGrant()).toBeNull();
    expect(harness.warnings.some((w) => w.event === "money_import_auto_grant_dropped")).toBe(true);
  });

  it("keeps the grant when the bank, not the credential, is the problem", async () => {
    const harness = createHarness({
      runImport: vi.fn(async () => {
        throw new Error("tbank page did not finish loading");
      }),
    });
    await harness.sweep.run("alarm");

    expect(harness.getGrant()).not.toBeNull();
    expect(harness.states["tbank::person-1"].consecutiveFailures).toBe(1);
  });

  it("does not hand a replacement grant the old one's failures", async () => {
    const harness = createHarness({
      grant: createGrant({ person_id: "person-2" }),
      states: {
        // Three is the point at which shouldAutoRun gives up entirely.
        "tbank::person-1": { lastRunAtMs: NOW - 1000, lastResult: "error", consecutiveFailures: 3 },
      },
    });
    await harness.sweep.run("visit");

    expect(harness.openedTabs).toHaveLength(1);
    expect(harness.states["tbank::person-2"].lastResult).toBe("ok");
  });
});
