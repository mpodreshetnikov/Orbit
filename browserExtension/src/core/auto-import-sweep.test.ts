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
      forgiveFailures: async () => 0,
    },
    openTab,
    waitForTabComplete: overrides.waitForTabComplete ?? vi.fn(async () => true),
    closeTab: vi.fn(async (tabId: number) => {
      closedTabs.push(tabId);
    }),
    runImport: overrides.runImport ?? vi.fn(async () => undefined),
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
      lastError: null,
      lastRunOrigin: "auto",
      lastOkAtMs: NOW,
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
        return undefined;
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
      .mockResolvedValueOnce(undefined);
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
    expect(harness.states["tbank::person-1"].lastError).toBe("signed out");
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

  it("says so when the history slice failed but the catch-up did not", async () => {
    const harness = createHarness({
      runImport: vi.fn(async () => ({ backfillError: { message: "markup changed" } })),
    });
    await harness.sweep.run("alarm");

    // Not a failed run -- the catch-up landed and the cursor holds -- but a connector that has
    // stopped working should not retry for weeks in silence.
    expect(harness.states["tbank::person-1"].lastResult).toBe("ok");
    expect(
      harness.warnings.some(
        (w) =>
          w.event === "money_import_auto_backfill_failed" &&
          w.attrs.error_message === "markup changed",
      ),
    ).toBe(true);
  });

  it("sweeps only the bank that was visited", async () => {
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank", "alfabank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
    });
    await harness.sweep.run("visit", { sourceId: "tbank" });

    // Opening T-Bank says T-Bank's session is live. It says nothing about Alfa-Bank, and the
    // first live run opened both -- which is what this pins down.
    expect(harness.openedTabs).toEqual(["https://www.tbank.ru/mybank/operations/"]);
    expect(harness.states["alfabank::person-1"]).toBeUndefined();
  });

  it("sweeps every covered bank on the alarm", async () => {
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank", "alfabank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
    });
    await harness.sweep.run("alarm");

    expect(harness.openedTabs).toHaveLength(2);
  });

  it("opens nothing for a visit to a bank the grant does not cover", async () => {
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
    });
    await harness.sweep.run("visit", { sourceId: "alfabank" });

    expect(harness.openedTabs).toEqual([]);
  });

  it("takes a bank visited during another bank's sweep once that sweep is done", async () => {
    let releaseFirst: () => void = () => {};
    const runImport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            releaseFirst = () => resolve(undefined);
          }),
      )
      .mockResolvedValue(undefined);
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank", "alfabank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
      runImport,
    });

    const first = harness.sweep.run("visit", { sourceId: "tbank" });
    await vi.waitFor(() => expect(runImport).toHaveBeenCalledTimes(1));
    // The second bank's alarm fires while the first is still importing. Before the sweep was
    // scoped, one pass covered both; dropping this call here would have left Alfa-Bank for the
    // next visit or the periodic alarm, hours away.
    await harness.sweep.run("visit", { sourceId: "alfabank" });
    expect(harness.openedTabs).toHaveLength(1);

    releaseFirst();
    await first;
    expect(harness.openedTabs).toEqual([
      "https://www.tbank.ru/mybank/operations/",
      "https://web.alfabank.ru/",
    ]);
    expect(runImport).toHaveBeenCalledTimes(2);
  });

  it("widens to every bank when the alarm fires during a scoped sweep", async () => {
    let releaseFirst: () => void = () => {};
    const runImport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            releaseFirst = () => resolve(undefined);
          }),
      )
      .mockResolvedValue(undefined);
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank", "alfabank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
      runImport,
    });

    const first = harness.sweep.run("visit", { sourceId: "tbank" });
    await vi.waitFor(() => expect(runImport).toHaveBeenCalledTimes(1));
    await harness.sweep.run("alarm");
    releaseFirst();
    await first;

    // T-Bank is on cooldown from the pass that just finished; Alfa-Bank is what the alarm adds.
    expect(harness.openedTabs).toEqual([
      "https://www.tbank.ru/mybank/operations/",
      "https://web.alfabank.ru/",
    ]);
  });

  it("keeps a queued bank for the next sweep when a manual run makes this one stand down", async () => {
    const harness = createHarness({
      grant: createGrant({ allowed_sources: ["tbank", "alfabank"] }),
      sources: () => [
        { sourceId: "tbank", targetUrl: "https://www.tbank.ru/mybank/operations/" },
        { sourceId: "alfabank", targetUrl: "https://web.alfabank.ru/" },
      ],
    });
    await harness.deps.sessionStore.setSession({ session_id: "manual-1" });
    await harness.sweep.run("visit", { sourceId: "alfabank" });
    expect(harness.openedTabs).toEqual([]);

    // The manual run ends; the next sweep, scoped to T-Bank, still owes Alfa-Bank.
    await harness.deps.sessionStore.setSession(null);
    await harness.sweep.run("visit", { sourceId: "tbank" });
    expect(harness.openedTabs.sort()).toEqual([
      "https://web.alfabank.ru/",
      "https://www.tbank.ru/mybank/operations/",
    ]);
  });
});

describe("a run the person asked for", () => {
  const stopped: AutoRunState = {
    lastRunAtMs: NOW - 60_000,
    lastResult: "error",
    consecutiveFailures: 3,
    lastError: "tbank did not stay on the operations page",
  };

  it("runs past the cooldown and the stop after failures, and clears the request on success", async () => {
    const cleared: string[] = [];
    const harness = createHarness({ states: { "tbank::person-1": stopped } });
    harness.deps.isRunRequested = async (sourceId) => sourceId === "tbank";
    harness.deps.clearRunRequest = async (sourceId) => {
      cleared.push(sourceId);
    };

    await harness.sweep.run("visit", { sourceId: "tbank" });

    expect(harness.openedTabs).toEqual(["https://www.tbank.ru/mybank/operations/"]);
    expect(harness.states["tbank::person-1"].lastResult).toBe("ok");
    expect(harness.states["tbank::person-1"].consecutiveFailures).toBe(0);
    expect(cleared).toEqual(["tbank"]);
  });

  it("keeps the request when the attempt fails, for the visit after the person has signed in", async () => {
    const cleared: string[] = [];
    const harness = createHarness({
      states: { "tbank::person-1": stopped },
      runImport: vi.fn(async () => {
        throw new Error("tbank did not stay on the operations page");
      }),
    });
    harness.deps.isRunRequested = async () => true;
    harness.deps.clearRunRequest = async (sourceId) => {
      cleared.push(sourceId);
    };

    await harness.sweep.run("visit", { sourceId: "tbank" });

    expect(harness.openedTabs).toHaveLength(1);
    expect(harness.states["tbank::person-1"].consecutiveFailures).toBe(4);
    expect(cleared).toEqual([]);
  });

  it("changes nothing for a source nobody asked about", async () => {
    const harness = createHarness({ states: { "tbank::person-1": stopped } });
    harness.deps.isRunRequested = async () => false;

    await harness.sweep.run("visit", { sourceId: "tbank" });

    expect(harness.openedTabs).toEqual([]);
  });
});
