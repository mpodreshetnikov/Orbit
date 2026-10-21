import { describe, expect, it, vi } from "vitest";
import {
  compareExtensionVersions,
  createSelfUpdater,
  isHostMissingError,
  parseReleaseInfo,
  type NativeHostReply,
  type ReleaseInfo,
  type SelfUpdaterDeps,
} from "./self-update.js";

const RELEASE: ReleaseInfo = {
  version: "0.1.24",
  sha256: "a".repeat(64),
  download_url: "https://privateorbit.space/storage/v1/object/public/x.zip",
};

function setup(overrides: Partial<SelfUpdaterDeps> & { busy?: boolean[] } = {}) {
  const busy = overrides.busy ?? [];
  const calls: Array<Record<string, unknown>> = [];
  const reload = vi.fn();
  const sendNative = vi.fn(async (message: Record<string, unknown>): Promise<NativeHostReply> => {
    calls.push(message);
    return { ok: true };
  });
  const deps: SelfUpdaterDeps = {
    supported: true,
    currentVersion: () => "0.1.23",
    fetchLatest: async () => RELEASE,
    isBusy: async () => (busy.length > 0 ? busy.shift()! : false),
    sendNative,
    reload,
    now: () => Date.parse("2026-10-21T12:00:00Z"),
    ...overrides,
  };
  return { updater: createSelfUpdater(deps), calls, reload, sendNative };
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

  it("holds the reload when an import started while the files were replaced", async () => {
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
