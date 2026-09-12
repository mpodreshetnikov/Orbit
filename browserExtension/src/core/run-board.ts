/**
 * The runs in flight in this service worker, described for whoever asks: the widget on the
 * bank page, the attention page, the popup.
 *
 * `activeImportRuns` answers one question -- is this session running -- for the janitor and the
 * keepalive. This holds what a page has to say about a run: whose it is, which window it reads,
 * how far it has got. It is fed from the same broadcasts the pages receive, so a page opened
 * mid-run reads here what it missed, and it stays in memory on purpose: a worker that starts
 * holds no runs, and the janitor closes whatever the store still says was running.
 */

/** Who started the run: the sweep on its own, the sweep on a person's request, or a person. */
export type RunOrigin = "auto" | "requested" | "manual";
/** Which window a scheduled run is reading; a person's run has whatever window they chose. */
export type RunWindowKind = "incremental" | "backfill" | "manual";

export interface LiveRunStart {
  session_id: string;
  source_id: string | null;
  payer_person_id: string | null;
  origin: RunOrigin;
  window_kind: RunWindowKind;
  window_from: string | null;
  window_to: string | null;
  /** The bank tab the run works in, when known. */
  tab_id: number | null;
  batch_id?: string | null;
}

export interface LiveRun extends LiveRunStart {
  started_at: string;
  running: boolean;
  phase: string | null;
  progress_percent: number;
  parsed_transactions_count: number | null;
  estimated_total_ms: number | null;
  estimated_remaining_ms: number | null;
  estimated_receipt_request_count: number | null;
  estimate_updated_at: string | null;
  batch_id: string | null;
  error: string | null;
}

export interface RunBoard {
  /** Registers a run as it begins; a later `observe` fills in what the broadcasts say. */
  start(entry: LiveRunStart): LiveRun;
  /**
   * Reads one broadcast -- progress, done, error -- into the run's record. A session the board
   * never saw start is recorded from the broadcast alone, as the popup's diagnostic runs are.
   */
  observe(sessionId: string, payload: Record<string, unknown>): LiveRun;
  end(sessionId: string): void;
  get(sessionId: string): LiveRun | null;
  /** The run reading this source, for this person when one is named. */
  findBySource(sourceId: string, payerPersonId?: string | null): LiveRun | null;
  list(): LiveRun[];
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createRunBoard(deps: { now?: () => number } = {}): RunBoard {
  const now = deps.now ?? (() => Date.now());
  const runs = new Map<string, LiveRun>();

  const blank = (sessionId: string): LiveRun => ({
    session_id: sessionId,
    source_id: null,
    payer_person_id: null,
    origin: "manual",
    window_kind: "manual",
    window_from: null,
    window_to: null,
    tab_id: null,
    started_at: new Date(now()).toISOString(),
    running: true,
    phase: null,
    progress_percent: 0,
    parsed_transactions_count: null,
    estimated_total_ms: null,
    estimated_remaining_ms: null,
    estimated_receipt_request_count: null,
    estimate_updated_at: null,
    batch_id: null,
    error: null,
  });

  return {
    start(entry) {
      const run: LiveRun = {
        ...blank(entry.session_id),
        ...entry,
        batch_id: entry.batch_id ?? null,
      };
      runs.set(entry.session_id, run);
      return run;
    },
    observe(sessionId, payload) {
      const current = runs.get(sessionId) ?? blank(sessionId);
      const type = toTrimmedString(payload.type);
      const running =
        typeof payload.running === "boolean"
          ? payload.running
          : type !== "MONEY_IMPORT_DONE" && type !== "MONEY_IMPORT_ERROR";
      const next: LiveRun = {
        ...current,
        running,
        phase: toTrimmedString(payload.phase) ?? current.phase,
        progress_percent: toFiniteNumber(payload.progress_percent) ?? current.progress_percent,
        parsed_transactions_count:
          toFiniteNumber(payload.parsed_transactions_count) ?? current.parsed_transactions_count,
        estimated_total_ms:
          toFiniteNumber(payload.estimated_total_ms) ?? current.estimated_total_ms,
        estimated_remaining_ms:
          toFiniteNumber(payload.estimated_remaining_ms) ?? current.estimated_remaining_ms,
        estimated_receipt_request_count:
          toFiniteNumber(payload.estimated_receipt_request_count) ??
          current.estimated_receipt_request_count,
        estimate_updated_at:
          toTrimmedString(payload.estimate_updated_at) ?? current.estimate_updated_at,
        batch_id: toTrimmedString(payload.batch_id) ?? current.batch_id,
        error: toTrimmedString(payload.error) ?? current.error,
      };
      runs.set(sessionId, next);
      return next;
    },
    end(sessionId) {
      runs.delete(sessionId);
    },
    get: (sessionId) => runs.get(sessionId) ?? null,
    findBySource(sourceId, payerPersonId) {
      for (const run of runs.values()) {
        if (run.source_id !== sourceId) continue;
        if (payerPersonId && run.payer_person_id && run.payer_person_id !== payerPersonId) continue;
        return run;
      }
      return null;
    },
    list: () => [...runs.values()],
  };
}

/** The board every path in this worker reports to. Tests build their own. */
export const liveRuns = createRunBoard();
