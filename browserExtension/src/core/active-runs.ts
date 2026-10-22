/**
 * The runs in flight in this service worker, by session id.
 *
 * Two paths run an import -- a person's `MONEY_IMPORT_RUN` and the sweep's `runScheduledImport`
 * -- and until now each kept its own idea of what was running, in memory, where a restart of
 * the worker erased it. This is the one place both report to, so the parties that need to know
 * (the janitor deciding whether a stored session is an orphan, the keepalive deciding whether
 * the worker may idle) get one answer.
 */
export interface ActiveRunRegistry {
  /** Takes the session for a run; false when a run already holds it, or an update does. */
  begin(sessionId: string): boolean;
  end(sessionId: string): void;
  has(sessionId: string): boolean;
  size(): number;
  /** Called with the new count after every change; returns the unsubscribe. */
  onChange(listener: (size: number) => void): () => void;
  /**
   * Keeps every run out while an update replaces the extension's files: null when a run is in
   * flight (or another hold is), otherwise the release. Checked and taken in one synchronous
   * step, so no run can begin between "nothing is running" and the files changing; see
   * `core/self-update.ts`.
   */
  holdForUpdate(): (() => void) | null;
  isHeldForUpdate(): boolean;
}

/** What a run that tried to begin during an update is told. */
export const UPDATE_IN_PROGRESS_ERROR =
  "The extension is installing an update; start the import again in a moment.";

export function createActiveRunRegistry(): ActiveRunRegistry {
  const running = new Set<string>();
  const listeners = new Set<(size: number) => void>();
  let held = false;
  const notify = () => {
    for (const listener of listeners) listener(running.size);
  };
  return {
    begin(sessionId) {
      if (held || running.has(sessionId)) return false;
      running.add(sessionId);
      notify();
      return true;
    },
    end(sessionId) {
      if (!running.delete(sessionId)) return;
      notify();
    },
    has: (sessionId) => running.has(sessionId),
    size: () => running.size,
    holdForUpdate() {
      if (held || running.size > 0) return null;
      held = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held = false;
      };
    },
    isHeldForUpdate: () => held,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The registry every path in this worker shares. Tests build their own. */
export const activeImportRuns = createActiveRunRegistry();
