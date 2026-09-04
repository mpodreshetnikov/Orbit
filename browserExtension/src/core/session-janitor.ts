import type { SessionStore } from "./session-store.js";

/**
 * What a stored session is, judged from what this worker can see.
 *
 * - `idle`: stored by the app for a run a person has not started yet. It waits for them, and
 *   for as long as the server would still take it.
 * - `running`: a run in this worker holds it.
 * - `expired`: past the server's `expires_at`; nothing can be done with it any more.
 * - `orphan`: a run had begun on it and no run in this worker holds it, so the run died with
 *   an earlier worker -- killed on a long wait, or the browser closed -- and its session was
 *   left behind. Every reader took that session for a person importing right now: the sweep
 *   stood down, the attention page stayed shut, the widget said "not running" (2026-09-03).
 */
export type StoredSessionVerdict = "idle" | "running" | "expired" | "orphan";

/** Set on the stored session when a run begins on it, so a later worker can tell an orphan. */
export const RUN_STARTED_AT_KEY = "run_started_at_ms";

export function judgeStoredSession(
  session: Record<string, unknown>,
  input: { nowMs: number; runActive: boolean },
): StoredSessionVerdict {
  const expiresAtMs = toEpochMs(session.expires_at);
  if (expiresAtMs !== null && expiresAtMs <= input.nowMs) return "expired";
  if (input.runActive) return "running";
  if (typeof session[RUN_STARTED_AT_KEY] === "number") return "orphan";
  return "idle";
}

export interface SessionJanitorDeps {
  store: SessionStore;
  isRunActive: (sessionId: string) => boolean;
  /** Tells the server the run is over. Best-effort; the session is cleared either way. */
  completeAsFailed: (session: Record<string, unknown>) => Promise<void>;
  now: () => number;
  onInfo?: (event: string, attrs: Record<string, unknown>) => void;
}

export interface SessionJanitor {
  /**
   * The store everything else should use: a session that is expired or an orphan is cleared on
   * the way out, so no reader ever sees one.
   */
  store: SessionStore;
  /** Judges the stored session and clears it when it is over; says what was found. */
  reconcile(reason: string): Promise<StoredSessionVerdict | "none">;
  /** Marks the stored session as running, if it is still the one given. */
  markRunStarted(sessionId: string): Promise<void>;
}

export function createSessionJanitor(deps: SessionJanitorDeps): SessionJanitor {
  async function reconcile(reason: string): Promise<StoredSessionVerdict | "none"> {
    const session = await deps.store.getSession();
    if (!session) return "none";
    const sessionId = readSessionId(session);
    const verdict = judgeStoredSession(session, {
      nowMs: deps.now(),
      runActive: sessionId !== null && deps.isRunActive(sessionId),
    });
    if (verdict !== "expired" && verdict !== "orphan") return verdict;

    deps.onInfo?.("money_import_stored_session_cleared", {
      reason,
      verdict,
      session_id: sessionId,
      batch_id: typeof session.batch_id === "string" ? session.batch_id : null,
    });
    // The server closes an expired session on its own; an orphan's session is still live
    // there, and this is the only party that knows the run behind it is gone.
    if (verdict === "orphan") await deps.completeAsFailed(session);
    // Cleared only while it is still the same session: the app may have stored a new one
    // during the await above, and that one is a person's import.
    const current = await deps.store.getSession();
    if (current && readSessionId(current) === sessionId) {
      await deps.store.setSession(null);
    }
    return verdict;
  }

  return {
    store: {
      async getSession() {
        const verdict = await reconcile("read");
        if (verdict === "none" || verdict === "expired" || verdict === "orphan") return null;
        return deps.store.getSession();
      },
      setSession: (session) => deps.store.setSession(session),
    },
    reconcile,
    async markRunStarted(sessionId) {
      const current = await deps.store.getSession();
      if (!current || readSessionId(current) !== sessionId) return;
      await deps.store.setSession({ ...current, [RUN_STARTED_AT_KEY]: deps.now() });
    },
  };
}

function readSessionId(session: Record<string, unknown>): string | null {
  return typeof session.session_id === "string" && session.session_id.trim()
    ? session.session_id.trim()
    : null;
}

function toEpochMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
