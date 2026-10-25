/**
 * Keeps an unpacked (developer-mode) install on the latest published release.
 *
 * An unpacked extension cannot rewrite its own folder, but `chrome.runtime.reload()` reads that
 * folder again from disk. So the files are replaced by a small native messaging host the person
 * installs once (`browserExtension/updater/`), and this module decides when to ask it and when
 * to reload. The host works in two steps for the reason below: `stage` downloads, verifies and
 * unpacks the release beside the folder, which is slow and harmless; `apply` mirrors the staged
 * copy over the folder, which is fast and is what a running import must never see.
 *
 * An import must never be cut by an update (Max, 2026-10-21). A reload ends the service worker
 * and every run in it, and a swap mid-run changes the scripts a run injects next. So `apply`
 * and the reload each happen only under a hold on the run registry, taken in the same
 * synchronous step that sees no run in flight, and kept until the reload: a run that tries to
 * begin meanwhile is refused rather than started on files that are changing. A stored session
 * (a run about to start) also defers both. An update found during an import waits, and goes
 * ahead when the import ends.
 *
 * A browser that updates the extension itself -- Firefox, from `update_url` -- holds a
 * downloaded version back while `runtime.onUpdateAvailable` has a listener, and installs it on
 * `runtime.reload()`. That reload goes through the same hold, so it waits for imports too.
 */

export const SELF_UPDATE_ALARM = "orbit-self-update";
export const SELF_UPDATE_PERIOD_MINUTES = 15;
export const NATIVE_HOST_NAME = "space.privateorbit.extension_updater";

export interface ReleaseInfo {
  version: string;
  sha256: string;
  download_url: string;
  /** The id the release's key gives it; null when the endpoint does not say. */
  extension_id: string | null;
}

export type SelfUpdatePhase =
  /** Not an unpacked production build, so there is nothing to keep up to date. */
  | "unsupported"
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "staging"
  /** Staged, and waiting for the import in progress to end. */
  | "waiting_for_import"
  | "applying"
  /** Files are replaced; the reload waits for the import that started meanwhile. */
  | "reload_pending"
  /** The browser installs a newer release itself and has not downloaded it yet. */
  | "browser_will_install"
  | "host_missing"
  | "error";

export interface SelfUpdateStatus {
  phase: SelfUpdatePhase;
  current_version: string;
  latest_version: string | null;
  checked_at: string | null;
  error: string | null;
}

export interface NativeHostReply {
  ok?: boolean;
  error?: string;
  version?: string;
  /** On a failed apply: whether the host put the previous files back. */
  restored?: boolean;
}

export interface SelfUpdaterDeps {
  supported: boolean;
  /**
   * The browser installs updates (Firefox from `update_url`): nothing is staged or applied here,
   * only the reload that installs what the browser downloaded. It has no API to look now --
   * Firefox does not implement `runtime.requestUpdateCheck` -- so a check only reports.
   */
  browserManaged?: boolean;
  /**
   * The version the browser is holding back. Kept outside the worker: the event comes once, and
   * an event page can be ended while the reload waits for an import.
   */
  pendingStore?: {
    get(): Promise<string | null>;
    set(version: string | null): Promise<void>;
  };
  /** This extension's id: a release built with another key would install as another extension. */
  extensionId: string;
  currentVersion: () => string;
  fetchLatest: () => Promise<ReleaseInfo | null>;
  /**
   * Keeps runs from beginning until the release is called; null while a run is in flight.
   * See `ActiveRunRegistry.holdForUpdate`.
   */
  holdImports: () => (() => void) | null;
  /** True while a session is stored: a run is about to start, or one is in flight. */
  isBusy: () => Promise<boolean>;
  sendNative: (message: Record<string, unknown>) => Promise<NativeHostReply>;
  reload: () => void;
  now?: () => number;
  onInfo?: (event: string, attrs: Record<string, unknown>) => void;
}

export interface SelfUpdater {
  status(): SelfUpdateStatus;
  /**
   * Looks for a newer release and installs it when nothing is importing. The alarm and the
   * popup's button both land here; the button only differs in being now.
   */
  check(origin: "alarm" | "startup" | "manual" | "settled" | "wake"): Promise<SelfUpdateStatus>;
  /** Called when an import ends; finishes an update that waited for it. */
  onImportsSettled(): Promise<void>;
  /** `runtime.onUpdateAvailable`: the browser downloaded `version` and waits for a reload. */
  onBrowserUpdateAvailable(version: string): Promise<void>;
}

/** Orders versions the way Chrome does: up to four dot-separated integers. Null if invalid. */
export function compareExtensionVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    const parts = value.trim().split(".");
    if (parts.length > 4 || !parts.every((part) => /^\d+$/.test(part))) return null;
    return parts.map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 4; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function parseReleaseInfo(payload: unknown): ReleaseInfo | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const version = typeof record.version === "string" ? record.version.trim() : "";
  const sha256 = typeof record.sha256 === "string" ? record.sha256.trim().toLowerCase() : "";
  const url = typeof record.download_url === "string" ? record.download_url.trim() : "";
  if (compareExtensionVersions(version, version) === null) return null;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (!url.startsWith("https://")) return null;
  const extensionId =
    typeof record.extension_id === "string" && record.extension_id.trim()
      ? record.extension_id.trim()
      : null;
  return { version, sha256, download_url: url, extension_id: extensionId };
}

/**
 * What Chrome says when no host is registered under the name ("Specified native messaging host
 * not found."; on Windows "Native messaging host <name> is not registered.") or the host does
 * not list this extension ("Access to the specified native messaging host is forbidden.").
 * Either way the person has to run the installer.
 */
/**
 * How long each outside call may take. A call that never answers -- a fetch the browser leaves
 * pending, a host stuck before its reply -- held the one pass every check shares, and the popup
 * said "Checking..." for good (Max, 2026-10-25). `stage` covers the host's lock wait and its
 * five-minute download; `apply` its lock wait and the mirror.
 */
export const SELF_UPDATE_TIMEOUTS_MS = {
  fetch: 30_000,
  stage: 11 * 60_000,
  apply: 6 * 60_000,
};

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer in ${ms / 1000} s.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function isHostMissingError(message: string): boolean {
  return /native messaging host.*(not found|is not registered|forbidden)/i.test(message);
}

export function createSelfUpdater(deps: SelfUpdaterDeps): SelfUpdater {
  const now = deps.now ?? Date.now;
  const fetchLatest = () =>
    withTimeout(deps.fetchLatest(), SELF_UPDATE_TIMEOUTS_MS.fetch, "The release check");
  const sendNative = (message: Record<string, unknown>) =>
    withTimeout(
      deps.sendNative(message),
      message.action === "stage" ? SELF_UPDATE_TIMEOUTS_MS.stage : SELF_UPDATE_TIMEOUTS_MS.apply,
      "The updater",
    );
  let state: SelfUpdateStatus = {
    phase: deps.supported ? "idle" : "unsupported",
    current_version: deps.currentVersion(),
    latest_version: null,
    checked_at: null,
    error: null,
  };
  /** The release staged by the host and not yet applied. */
  let staged: ReleaseInfo | null = null;
  let inFlight: Promise<SelfUpdateStatus> | null = null;
  /** An import ended while a pass was already running, after it may have decided to wait. */
  let settledDuringPass = false;
  /** The browser announced an update while a pass was running. */
  let browserUpdateDuringPass = false;

  const set = (patch: Partial<SelfUpdateStatus>) => {
    state = { ...state, ...patch };
  };

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    set({ phase: isHostMissingError(message) ? "host_missing" : "error", error: message });
    deps.onInfo?.("extension_self_update_failed", { error: message });
  };

  /**
   * Kept after an apply that failed and could not put the old files back: the folder holds
   * neither release, so no run may begin on it until an apply succeeds. A worker that starts
   * on such a folder could not run either, which is why the host restores before it fails.
   */
  let brokenTreeHold: (() => void) | null = null;

  /**
   * Runs `step` with runs kept out, or reports `waitingPhase` when an import is in flight or
   * about to start. `step` says what becomes of the hold: released when it is done, kept when
   * the files are broken, and left alone after a reload -- releasing it then would let a run
   * already awaiting storage begin in the moments before the worker goes.
   */
  const whenIdle = async (
    waitingPhase: SelfUpdatePhase,
    step: (release: () => void) => Promise<"done" | "kept" | "reloaded">,
  ) => {
    const release = brokenTreeHold ?? deps.holdImports();
    if (!release) {
      set({ phase: waitingPhase });
      return;
    }
    let outcome: "done" | "kept" | "reloaded" = "done";
    try {
      // Under a kept hold nothing has begun since, and the folder must be repaired regardless.
      if (!brokenTreeHold && (await deps.isBusy())) {
        set({ phase: waitingPhase });
        return;
      }
      outcome = await step(release);
    } finally {
      if (outcome === "done") release();
    }
  };

  const reloadNow = () => {
    deps.onInfo?.("extension_self_update_reloading", { to: state.latest_version });
    deps.reload();
  };

  const reloadWhenIdle = () =>
    whenIdle("reload_pending", async () => {
      reloadNow();
      return "reloaded";
    });

  const applyWhenIdle = async () => {
    const release = staged;
    if (!release) return;
    await whenIdle("waiting_for_import", async (releaseHold) => {
      set({ phase: "applying" });
      let reply: NativeHostReply;
      try {
        reply = await sendNative({ action: "apply", version: release.version });
      } catch (error) {
        fail(error);
        // A host Chrome could not start touched nothing. Any other failure -- one that never
        // answered -- may be mirroring still, so the folder is treated as broken.
        if (isHostMissingError(state.error ?? "")) return "done";
        brokenTreeHold = releaseHold;
        return "kept";
      }
      if (!reply?.ok) {
        fail(new Error(reply?.error || "The updater could not apply the release."));
        if (reply?.restored) {
          brokenTreeHold = null;
          return "done";
        }
        brokenTreeHold = releaseHold;
        return "kept";
      }
      staged = null;
      brokenTreeHold = null;
      // Still under the same hold, so no run has begun since the files changed; a session the
      // app stored meanwhile still defers the reload, as it deferred the apply.
      if (await deps.isBusy()) {
        set({ phase: "reload_pending" });
        return "done";
      }
      reloadNow();
      return "reloaded";
    });
  };

  /** A check where the browser installs: reload for what it holds back, or say what is out. */
  const runBrowserManaged = async (origin: string) => {
    const current = state.current_version;
    const pending = (await deps.pendingStore?.get()) ?? null;
    if (pending && (compareExtensionVersions(pending, current) ?? 0) > 0) {
      set({ latest_version: pending, phase: "reload_pending" });
      await reloadWhenIdle();
      return;
    }
    if (pending) await deps.pendingStore?.set(null);
    // Only a check someone or something scheduled asks the server; a worker waking or an import
    // ending only looks for a held-back update, and they happen all the time.
    if (origin === "settled" || origin === "wake") {
      set({ phase: "idle" });
      return;
    }
    const latest = await fetchLatest();
    set({ checked_at: new Date(now()).toISOString(), latest_version: latest?.version ?? null });
    if (!latest) {
      set({ phase: "error", error: "No published release was found." });
      return;
    }
    const order = compareExtensionVersions(latest.version, current);
    set({ phase: order !== null && order > 0 ? "browser_will_install" : "up_to_date" });
  };

  const run = async (origin: string): Promise<SelfUpdateStatus> => {
    try {
      set({ phase: "checking", error: null });
      if (deps.browserManaged) {
        await runBrowserManaged(origin);
        return { ...state };
      }
      const latest = await fetchLatest();
      set({ checked_at: new Date(now()).toISOString() });
      if (!latest) {
        set({ phase: "error", error: "No published release was found." });
        return { ...state };
      }
      set({ latest_version: latest.version });
      if (latest.extension_id && latest.extension_id !== deps.extensionId) {
        throw new Error(
          `The published release is for extension ${latest.extension_id}, not ${deps.extensionId}.`,
        );
      }
      const order = compareExtensionVersions(latest.version, state.current_version);
      if (order === null || order <= 0) {
        set({ phase: "up_to_date" });
        return { ...state };
      }
      set({ phase: "available" });
      deps.onInfo?.("extension_self_update_found", {
        origin,
        from: state.current_version,
        to: latest.version,
      });
      if (staged?.version !== latest.version) {
        set({ phase: "staging" });
        const reply = await sendNative({
          action: "stage",
          version: latest.version,
          sha256: latest.sha256,
          url: latest.download_url,
        });
        if (!reply?.ok) throw new Error(reply?.error || "The updater could not stage the release.");
        staged = latest;
      }
      await applyWhenIdle();
    } catch (error) {
      fail(error);
    }
    return { ...state };
  };

  /** One pass: whatever the update owes next, from where the last pass left it. */
  const pass = async (origin: string): Promise<SelfUpdateStatus> => {
    try {
      if (state.phase === "reload_pending") {
        await reloadWhenIdle();
        return { ...state };
      }
      // A kept hold means the folder is broken: repair it with the staged release first.
      if ((state.phase === "waiting_for_import" || brokenTreeHold) && staged) {
        await applyWhenIdle();
        return { ...state };
      }
    } catch (error) {
      fail(error);
      return { ...state };
    }
    return run(origin);
  };

  /**
   * Every entry goes through one pass at a time, so two of them never drive the host at once.
   * An import that ends while a pass runs gets a pass of its own afterwards: the running one
   * may already have decided to wait for it.
   */
  const drive = (origin: string): Promise<SelfUpdateStatus> => {
    if (inFlight) return inFlight;
    inFlight = pass(origin).finally(() => {
      inFlight = null;
      if (browserUpdateDuringPass) {
        browserUpdateDuringPass = false;
        settledDuringPass = false;
        void drive("browser");
        return;
      }
      if (settledDuringPass) {
        settledDuringPass = false;
        if (state.phase === "waiting_for_import" || state.phase === "reload_pending") {
          void drive("settled");
        }
      }
    });
    return inFlight;
  };

  return {
    status: () => ({ ...state }),
    async check(origin) {
      if (!deps.supported) return { ...state };
      return drive(origin);
    },
    async onImportsSettled() {
      if (!deps.supported) return;
      if (inFlight) {
        settledDuringPass = true;
        return;
      }
      // "idle" is a worker that started after the last pass: the service worker is ended when
      // idle, and with it what an earlier one staged and was waiting to apply. A full check
      // finds it again, and the host still holds the staged copy.
      if (
        state.phase === "idle" ||
        state.phase === "waiting_for_import" ||
        state.phase === "reload_pending"
      ) {
        await drive("settled");
      }
    },
    async onBrowserUpdateAvailable(version) {
      await deps.pendingStore?.set(version);
      deps.onInfo?.("extension_self_update_found", { origin: "browser", to: version });
      if (inFlight) {
        browserUpdateDuringPass = true;
        return;
      }
      set({ latest_version: version, phase: "reload_pending", error: null });
      await drive("browser");
    },
  };
}
