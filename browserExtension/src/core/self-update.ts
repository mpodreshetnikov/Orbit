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
 * and the reload each happen only when nothing is importing, checked right before each of them;
 * an update found during an import waits, and goes ahead when the import ends.
 */

export const SELF_UPDATE_ALARM = "orbit-self-update";
export const SELF_UPDATE_PERIOD_MINUTES = 15;
export const NATIVE_HOST_NAME = "space.privateorbit.extension_updater";

export interface ReleaseInfo {
  version: string;
  sha256: string;
  download_url: string;
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
}

export interface SelfUpdaterDeps {
  supported: boolean;
  currentVersion: () => string;
  fetchLatest: () => Promise<ReleaseInfo | null>;
  /** True while an import runs or a session waits for one. */
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
  check(origin: "alarm" | "startup" | "manual"): Promise<SelfUpdateStatus>;
  /** Called when an import ends; finishes an update that waited for it. */
  onImportsSettled(): Promise<void>;
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
  return { version, sha256, download_url: url };
}

/**
 * What Chrome says when no host is registered under the name ("Specified native messaging host
 * not found.") or the host does not list this extension ("Access to the specified native
 * messaging host is forbidden."). Either way the person has to run the installer.
 */
export function isHostMissingError(message: string): boolean {
  return /native messaging host.*(not found|forbidden)/i.test(message);
}

export function createSelfUpdater(deps: SelfUpdaterDeps): SelfUpdater {
  const now = deps.now ?? Date.now;
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

  const set = (patch: Partial<SelfUpdateStatus>) => {
    state = { ...state, ...patch };
  };

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    set({ phase: isHostMissingError(message) ? "host_missing" : "error", error: message });
    deps.onInfo?.("extension_self_update_failed", { error: message });
  };

  const reloadWhenIdle = async () => {
    if (await deps.isBusy()) {
      set({ phase: "reload_pending" });
      return;
    }
    deps.onInfo?.("extension_self_update_reloading", { to: state.latest_version });
    deps.reload();
  };

  const applyWhenIdle = async () => {
    if (!staged) return;
    if (await deps.isBusy()) {
      set({ phase: "waiting_for_import" });
      return;
    }
    set({ phase: "applying" });
    const reply = await deps.sendNative({ action: "apply", version: staged.version });
    if (!reply?.ok) throw new Error(reply?.error || "The updater could not apply the release.");
    staged = null;
    await reloadWhenIdle();
  };

  const run = async (origin: string): Promise<SelfUpdateStatus> => {
    try {
      set({ phase: "checking", error: null });
      const latest = await deps.fetchLatest();
      set({ checked_at: new Date(now()).toISOString() });
      if (!latest) {
        set({ phase: "error", error: "No published release was found." });
        return { ...state };
      }
      set({ latest_version: latest.version });
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
        const reply = await deps.sendNative({
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

  return {
    status: () => ({ ...state }),
    async check(origin) {
      if (!deps.supported) return { ...state };
      // A reload is already owed; checking again would only stage the same files twice.
      if (state.phase === "reload_pending") {
        await reloadWhenIdle();
        return { ...state };
      }
      if (!inFlight) {
        inFlight = run(origin).finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    async onImportsSettled() {
      if (!deps.supported) return;
      try {
        if (state.phase === "reload_pending") await reloadWhenIdle();
        else if (state.phase === "waiting_for_import") await applyWhenIdle();
      } catch (error) {
        fail(error);
      }
    },
  };
}
