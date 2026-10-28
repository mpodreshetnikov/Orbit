import { describe, expect, it, vi } from "vitest";
import { createActiveRunRegistry } from "./active-runs.js";
import {
  compareExtensionVersions,
  createSelfUpdater,
  isHostMissingError,
  parseReleaseInfo,
  SELF_UPDATE_TIMEOUTS_MS,
  type NativeHostReply,
  type ReleaseInfo,
  type SelfUpdaterDeps,
} from "./self-update.js";

const RELEASE: ReleaseInfo = {
  version: "0.1.24",
  sha256: "a".repeat(64),
  download_url: "https://privateorbit.space/storage/v1/object/public/x.zip",
  extension_id: "orbit-id",
  firefox_download_url: null,
};

function setup(overrides: Partial<SelfUpdaterDeps> & { busy?: boolean[] } = {}) {
  const busy = overrides.busy ?? [];
  const registry = createActiveRunRegistry();
  const calls: Array<Record<string, unknown>> = [];
  const reload = vi.fn();
  const sendNative = vi.fn(async (message: Record<string, unknown>): Promise<NativeHostReply> => {
    calls.push(message);
    return { ok: true };
  });
  const deps: SelfUpdaterDeps = {
    supported: true,
    extensionId: "orbit-id",
    currentVersion: () => "0.1.23",
    fetchLatest: async () => RELEASE,
    holdImports: () => registry.holdForUpdate(),
    isBusy: async () => (busy.length > 0 ? busy.shift()! : false),
    sendNative,
    reload,
    now: () => Date.parse("2026-10-21T12:00:00Z"),
    ...overrides,
  };
  return { updater: createSelfUpdater(deps), calls, reload, sendNative, registry };
}

describe("compareExtensionVersions", () => {
  it("orders numerically, not as text", () => {
    expect(compareExtensionVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareExtensionVersions("0.1.9", "0.1.10")).toBe(-1);
    expect(compareExtensionVersions("1.0", "1.0.0")).toBe(0);
  });

  it("returns null for anything Chrome would not accept", () => {
    expect(compareExtensionVersions("0.1.x", "0.1.0")).toBeNull();
    expect(compareExtensionVersions("1.2.3.4.5", "1")).toBeNull();
    expect(compareExtensionVersions("", "1")).toBeNull();
  });
});

describe("parseReleaseInfo", () => {
  it("accepts what the release endpoint returns", () => {
    expect(parseReleaseInfo({ ...RELEASE, sha256: "A".repeat(64), extra: 1 })).toEqual(RELEASE);
  });

  it("takes the signed Firefox package's link when the release has one", () => {
    const xpi = "https://privateorbit.space/storage/v1/object/public/x.xpi";
    expect(
      parseReleaseInfo({ ...RELEASE, firefox: { download_url: xpi } })?.firefox_download_url,
    ).toBe(xpi);
    expect(
      parseReleaseInfo({ ...RELEASE, firefox: { download_url: "http://x/y.xpi" } })
        ?.firefox_download_url,
    ).toBeNull();
  });

  it("keeps the id only when the endpoint gives one", () => {
    const { extension_id: _omitted, ...withoutId } = RELEASE;
    expect(parseReleaseInfo(withoutId)?.extension_id).toBeNull();
  });

  it("refuses a release it could not verify or fetch safely", () => {
    expect(parseReleaseInfo(null)).toBeNull();
    expect(parseReleaseInfo({ ...RELEASE, sha256: "abc" })).toBeNull();
    expect(parseReleaseInfo({ ...RELEASE, download_url: "http://x/y.zip" })).toBeNull();
    expect(parseReleaseInfo({ ...RELEASE, version: "latest" })).toBeNull();
  });
});

describe("isHostMissingError", () => {
  it("recognises both of Chrome's messages for an unusable host", () => {
    expect(isHostMissingError("Specified native messaging host not found.")).toBe(true);
    expect(isHostMissingError("Access to the specified native messaging host is forbidden.")).toBe(
      true,
    );
    expect(
      isHostMissingError(
        "Native messaging host space.privateorbit.extension_updater is not registered.",
      ),
    ).toBe(true);
    expect(isHostMissingError("Download failed: 404 not found")).toBe(false);
  });
});

describe("createSelfUpdater", () => {
  it("does nothing outside an unpacked production build", async () => {
    const { updater, sendNative } = setup({ supported: false });
    expect((await updater.check("manual")).phase).toBe("unsupported");
    await updater.onImportsSettled();
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("stages, applies and reloads when a newer release is out and nothing imports", async () => {
    const { updater, calls, reload } = setup();
    const status = await updater.check("alarm");
    expect(calls).toEqual([
      { action: "stage", version: "0.1.24", sha256: RELEASE.sha256, url: RELEASE.download_url },
      { action: "apply", version: "0.1.24" },
    ]);
    expect(reload).toHaveBeenCalledOnce();
    expect(status.latest_version).toBe("0.1.24");
    expect(status.checked_at).toBe("2026-10-21T12:00:00.000Z");
  });

  it("leaves an up-to-date install alone", async () => {
    const { updater, sendNative } = setup({ currentVersion: () => "0.1.24" });
    expect((await updater.check("manual")).phase).toBe("up_to_date");
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("never applies during an import, and applies when it ends", async () => {
    const { updater, calls, reload } = setup({ busy: [true] });
    expect((await updater.check("manual")).phase).toBe("waiting_for_import");
    expect(calls.map((call) => call.action)).toEqual(["stage"]);
    expect(reload).not.toHaveBeenCalled();

    await updater.onImportsSettled();
    expect(calls.map((call) => call.action)).toEqual(["stage", "apply"]);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps waiting while the import is still running", async () => {
    const { updater, calls } = setup({ busy: [true, true] });
    await updater.check("alarm");
    await updater.onImportsSettled();
    expect(updater.status().phase).toBe("waiting_for_import");
    expect(calls.map((call) => call.action)).toEqual(["stage"]);
  });

  it("waits while a run is in flight, whatever the stored session says", async () => {
    const { updater, calls, registry } = setup();
    registry.begin("run-1");
    expect((await updater.check("alarm")).phase).toBe("waiting_for_import");
    expect(calls.map((call) => call.action)).toEqual(["stage"]);
    registry.end("run-1");
    await updater.onImportsSettled();
    expect(calls.map((call) => call.action)).toEqual(["stage", "apply"]);
  });

  it("keeps a run from beginning while the files are replaced", async () => {
    let begunDuringApply: boolean | null = null;
    const registry = createActiveRunRegistry();
    const { updater, reload } = setup({
      holdImports: () => registry.holdForUpdate(),
      sendNative: async (message) => {
        if (message.action === "apply") begunDuringApply = registry.begin("run-1");
        return { ok: true };
      },
    });
    await updater.check("manual");
    expect(begunDuringApply).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    // Kept: a run awaiting storage could otherwise begin in the moments before the worker goes.
    expect(registry.isHeldForUpdate()).toBe(true);
  });

  it("releases the hold when the host put the previous files back", async () => {
    const { updater, registry } = setup({
      sendNative: async (message) =>
        message.action === "apply"
          ? { ok: false, error: "disk full", restored: true }
          : { ok: true },
    });
    expect((await updater.check("manual")).error).toBe("disk full");
    expect(registry.isHeldForUpdate()).toBe(false);
  });

  it("keeps runs out of a half-replaced folder until an apply succeeds", async () => {
    let applies = 0;
    const { updater, registry, reload } = setup({
      sendNative: async (message) => {
        if (message.action !== "apply") return { ok: true };
        applies += 1;
        return applies === 1 ? { ok: false, error: "locked", restored: false } : { ok: true };
      },
    });
    expect((await updater.check("alarm")).phase).toBe("error");
    expect(registry.isHeldForUpdate()).toBe(true);
    expect(registry.begin("run-1")).toBe(false);

    await updater.check("manual");
    expect(applies).toBe(2);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stages again before retrying an apply that timed out but finished late", async () => {
    vi.useFakeTimers();
    try {
      // Like both hosts: a successful apply removes the staged copy it mirrored from.
      const onHost = new Set<string>();
      let applies = 0;
      const actions: string[] = [];
      const { updater, registry, reload } = setup({
        sendNative: (message) => {
          const version = String(message.version);
          actions.push(String(message.action));
          if (message.action === "stage") {
            onHost.add(version);
            return Promise.resolve({ ok: true });
          }
          if (!onHost.has(version)) {
            return Promise.resolve({ ok: false, error: `Version ${version} is not staged.` });
          }
          applies += 1;
          if (applies === 1) {
            // Answers after the extension gave up on it.
            return new Promise((resolve) =>
              setTimeout(() => {
                onHost.delete(version);
                resolve({ ok: true });
              }, SELF_UPDATE_TIMEOUTS_MS.apply + 1_000),
            );
          }
          onHost.delete(version);
          return Promise.resolve({ ok: true });
        },
      });
      const first = updater.check("manual");
      await vi.advanceTimersByTimeAsync(SELF_UPDATE_TIMEOUTS_MS.apply + 2_000);
      expect((await first).phase).toBe("error");
      expect(registry.begin("run-1")).toBe(false);

      await updater.check("manual");
      expect(actions).toEqual(["stage", "apply", "stage", "apply"]);
      expect(reload).toHaveBeenCalledOnce();
      expect(registry.isHeldForUpdate()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the reload when a session was stored while the files were replaced", async () => {
    const { updater, reload } = setup({ busy: [false, true] });
    expect((await updater.check("alarm")).phase).toBe("reload_pending");
    expect(reload).not.toHaveBeenCalled();
    await updater.onImportsSettled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads on the next check once a held reload is free to go", async () => {
    const { updater, reload, calls } = setup({ busy: [false, true] });
    await updater.check("alarm");
    await updater.check("manual");
    expect(reload).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.action)).toEqual(["stage", "apply"]);
  });

  it("does not stage the same release twice while waiting", async () => {
    const { updater, calls } = setup({ busy: [true, true] });
    await updater.check("alarm");
    await updater.check("alarm");
    expect(calls.map((call) => call.action)).toEqual(["stage"]);
  });

  it("reports a missing host so the popup can say how to install it", async () => {
    const { updater } = setup({
      sendNative: async () => {
        throw new Error("Specified native messaging host not found.");
      },
    });
    expect((await updater.check("manual")).phase).toBe("host_missing");
  });

  it("reports the host's own failure as an error", async () => {
    const { updater, reload } = setup({
      sendNative: async () => ({ ok: false, error: "sha256 mismatch" }),
    });
    const status = await updater.check("manual");
    expect(status).toMatchObject({ phase: "error", error: "sha256 mismatch" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports a failed apply and does not reload", async () => {
    let call = 0;
    const { updater, reload } = setup({
      sendNative: async () => (call++ === 0 ? { ok: true } : { ok: false }),
    });
    const status = await updater.check("manual");
    expect(status).toMatchObject({ phase: "error" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses a release built for another extension id", async () => {
    const { updater, sendNative } = setup({
      fetchLatest: async () => ({ ...RELEASE, extension_id: "someone-else" }),
    });
    const status = await updater.check("alarm");
    expect(status.phase).toBe("error");
    expect(status.error).toContain("someone-else");
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("finds a waiting update again in a worker that started after the import ended", async () => {
    // A fresh worker: nothing staged in memory, the phase is idle.
    const { updater, calls, reload } = setup();
    await updater.onImportsSettled();
    expect(calls.map((call) => call.action)).toEqual(["stage", "apply"]);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("leaves an up-to-date or failed updater alone when an import ends", async () => {
    const { updater, sendNative } = setup({ currentVersion: () => "0.1.24" });
    await updater.check("alarm");
    const fetches = sendNative.mock.calls.length;
    await updater.onImportsSettled();
    expect(sendNative.mock.calls.length).toBe(fetches);
  });

  it("runs another pass when an import ends while one is deciding to wait", async () => {
    let settle: (() => Promise<void>) | null = null;
    let first = true;
    const { updater, calls, reload } = setup({
      isBusy: async () => {
        if (first) {
          first = false;
          // The import ends right after this pass saw it.
          void settle?.();
          return true;
        }
        return false;
      },
    });
    settle = () => updater.onImportsSettled();
    await updater.check("alarm");
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(calls.map((call) => call.action)).toEqual(["stage", "apply"]);
  });

  it("gives up on a release check that never answers", async () => {
    vi.useFakeTimers();
    try {
      const { updater } = setup({ fetchLatest: () => new Promise(() => undefined) });
      const status = updater.check("manual");
      await vi.advanceTimersByTimeAsync(SELF_UPDATE_TIMEOUTS_MS.fetch);
      expect(await status).toMatchObject({ phase: "error" });
      expect((await status).error).toContain("did not answer");
      // The pass is over, so the next check is a new one rather than the stuck one.
      expect(updater.status().phase).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a host that never replies, and keeps runs out if it was applying", async () => {
    vi.useFakeTimers();
    try {
      const { updater, registry } = setup({
        sendNative: (message) =>
          message.action === "apply" ? new Promise(() => undefined) : Promise.resolve({ ok: true }),
      });
      const status = updater.check("manual");
      await vi.advanceTimersByTimeAsync(SELF_UPDATE_TIMEOUTS_MS.apply);
      expect(await status).toMatchObject({ phase: "error" });
      expect(registry.isHeldForUpdate()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports when nothing is published", async () => {
    const { updater } = setup({ fetchLatest: async () => null });
    expect((await updater.check("alarm")).phase).toBe("error");
  });

  it("shares one check between overlapping callers", async () => {
    const fetchLatest = vi.fn(async () => RELEASE);
    const { updater } = setup({ fetchLatest });
    await Promise.all([updater.check("alarm"), updater.check("manual")]);
    expect(fetchLatest).toHaveBeenCalledOnce();
  });
});

describe("createSelfUpdater, where the browser installs updates", () => {
  function browserSetup(overrides: Partial<SelfUpdaterDeps> & { busy?: boolean[] } = {}) {
    let pending: string | null = null;
    const pendingStore = {
      get: async () => pending,
      set: async (version: string | null) => {
        pending = version;
      },
    };
    const env = setup({ browserManaged: true, pendingStore, ...overrides });
    return { ...env, pending: () => pending };
  }

  it("reloads into the update the browser downloaded once nothing imports", async () => {
    const { updater, reload, sendNative } = browserSetup();
    await updater.onBrowserUpdateAvailable("0.1.24");
    expect(reload).toHaveBeenCalledOnce();
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("holds the reload during an import, and reloads when it ends", async () => {
    const { updater, reload, registry } = browserSetup();
    registry.begin("run-1");
    await updater.onBrowserUpdateAvailable("0.1.24");
    expect(updater.status().phase).toBe("reload_pending");
    expect(reload).not.toHaveBeenCalled();
    registry.end("run-1");
    await updater.onImportsSettled();
    expect(reload).toHaveBeenCalledOnce();
    expect(registry.isHeldForUpdate()).toBe(true);
  });

  it("finds a held-back update again in a worker that started after the event", async () => {
    const first = browserSetup({ busy: [true] });
    await first.updater.onBrowserUpdateAvailable("0.1.24");
    expect(first.reload).not.toHaveBeenCalled();

    // The event page was ended while it waited; a new one only has the stored version.
    const stored = first.pending();
    const { updater, reload } = setup({
      browserManaged: true,
      pendingStore: { get: async () => stored, set: async () => undefined },
    });
    await updater.onImportsSettled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("looks for a held-back update when the worker wakes, without asking the server", async () => {
    const fetchLatest = vi.fn(async () => RELEASE);
    const { updater, reload } = setup({
      browserManaged: true,
      fetchLatest,
      pendingStore: { get: async () => "0.1.24", set: async () => undefined },
    });
    await updater.check("wake");
    expect(reload).toHaveBeenCalledOnce();

    const idle = setup({ browserManaged: true, fetchLatest, pendingStore: undefined });
    expect((await idle.updater.check("wake")).phase).toBe("idle");
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("reports a newer release the browser has not fetched yet, and installs nothing", async () => {
    const { updater, reload, sendNative } = browserSetup({
      // The endpoint names the Chrome build's id; nothing here is installed from it.
      fetchLatest: async () => ({ ...RELEASE, extension_id: "chrome-id" }),
    });
    expect((await updater.check("manual")).phase).toBe("browser_will_install");
    expect(reload).not.toHaveBeenCalled();
    expect(sendNative).not.toHaveBeenCalled();
  });

  it("offers the signed package where the browser installs from a link", async () => {
    // Firefox holds back an update that asks for new permissions until the person agrees.
    const xpi = "https://privateorbit.space/storage/v1/object/public/x.xpi";
    const fetchLatest = async () => ({ ...RELEASE, firefox_download_url: xpi });
    const firefox = browserSetup({ installsFromLink: true, fetchLatest });
    expect((await firefox.updater.check("manual")).install_url).toBe(xpi);

    const other = browserSetup({ fetchLatest });
    expect((await other.updater.check("manual")).install_url).toBeNull();

    const current = browserSetup({
      installsFromLink: true,
      fetchLatest: async () => ({ ...RELEASE, version: "0.1.23", firefox_download_url: xpi }),
    });
    expect((await current.updater.check("manual")).install_url).toBeNull();
  });

  it("does not call a failed check up to date", async () => {
    const { updater } = browserSetup({ fetchLatest: async () => null });
    expect((await updater.check("manual")).phase).toBe("error");
  });

  it("forgets a held-back version once it is the one running", async () => {
    let pending: string | null = "0.1.24";
    const { updater, reload } = setup({
      browserManaged: true,
      currentVersion: () => "0.1.24",
      pendingStore: {
        get: async () => pending,
        set: async (version) => {
          pending = version;
        },
      },
    });
    expect((await updater.check("startup")).phase).toBe("up_to_date");
    expect(pending).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
