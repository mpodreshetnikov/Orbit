import type {
  Connector,
  ConnectorParseDebugSummary,
  ConnectorParseStrategy,
} from "../connectors/types.js";
import {
  planBackfillSlice,
  planIncrementalWindow,
  shouldAdvanceBackfillCursor,
  type BackfillSlice,
} from "./backfill-scheduler.js";
import type { BackfillStore } from "./backfill-store.js";
import type { SessionStore } from "./session-store.js";

export interface ImportRunnerDeps {
  getConnector: (sourceId: string) => Connector | null;
  callEdge: (
    functionUrl: string,
    token: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  broadcastToAppTabs: (message: Record<string, unknown>) => Promise<void>;
  nowIso: () => string;
}

type ProgressPhase = string;
const PREVIEW_ROWS_CHUNK_SIZE = 50;

export interface ImportRunnerDebugConfig {
  enabled?: boolean;
  parseOnly?: boolean;
  tabId?: number;
  debugRunId?: string;
  emit?: (event: string, attrs?: Record<string, unknown>) => void;
}

function resolveEdgeAuthToken(session: Record<string, unknown>): {
  token: string;
  token_mode: "user" | "session";
} {
  const userToken =
    typeof session.user_access_token === "string" ? session.user_access_token.trim() : "";
  if (userToken) {
    return { token: userToken, token_mode: "user" };
  }
  const sessionToken =
    typeof session.session_token === "string" ? session.session_token.trim() : "";
  return { token: sessionToken, token_mode: "session" };
}

function resolveEdgeTarget(functionUrl: unknown): {
  url: string | null;
  scheme: string | null;
  host: string | null;
  path: string | null;
} {
  if (typeof functionUrl !== "string" || !functionUrl.trim()) {
    return { url: null, scheme: null, host: null, path: null };
  }
  try {
    const parsed = new URL(functionUrl);
    return {
      url: functionUrl,
      scheme: parsed.protocol.replace(":", ""),
      host: parsed.host,
      path: parsed.pathname,
    };
  } catch {
    return { url: functionUrl, scheme: null, host: null, path: null };
  }
}

function extractErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {
      error_message: error instanceof Error ? error.message : String(error),
      error_code: null,
      edge_action: null,
      edge_host: null,
      edge_path: null,
      edge_http_status: null,
      edge_transport: null,
      edge_response_error: null,
      error_name: error instanceof Error ? error.name : null,
    };
  }

  const candidate = error as Record<string, unknown>;
  return {
    error_message: error instanceof Error ? error.message : "Unknown import error",
    error_code: typeof candidate.code === "string" ? candidate.code : null,
    edge_action: typeof candidate.action === "string" ? candidate.action : null,
    edge_host: typeof candidate.function_host === "string" ? candidate.function_host : null,
    edge_path: typeof candidate.function_path === "string" ? candidate.function_path : null,
    edge_http_status:
      typeof candidate.http_status === "number" && Number.isFinite(candidate.http_status)
        ? candidate.http_status
        : null,
    edge_transport: typeof candidate.transport === "string" ? candidate.transport : null,
    edge_response_error:
      typeof candidate.response_error === "string" ? candidate.response_error : null,
    error_name: error instanceof Error ? error.name : null,
  };
}

function buildProgressMessage(
  phase: ProgressPhase,
  progressPercent: number,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...payload,
    phase,
    progress_percent: progressPercent,
  };
}

async function broadcastProgress(
  deps: Pick<ImportRunnerDeps, "broadcastToAppTabs">,
  phase: ProgressPhase,
  progressPercent: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await deps.broadcastToAppTabs(buildProgressMessage(phase, progressPercent, payload));
}

function chunkPreviewRows<T>(rows: T[], chunkSize: number): T[][] {
  if (rows.length === 0) return [[]];

  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    chunks.push(rows.slice(start, start + chunkSize));
  }
  return chunks;
}

function resolvePreviewProgressPercent(chunkIndex: number, chunkCount: number): number {
  if (chunkCount <= 1) return 75;
  return 75 + Math.round((14 * chunkIndex) / (chunkCount - 1));
}

export async function runImportSession(
  session: Record<string, unknown>,
  windowFromInput: string | undefined,
  deps: ImportRunnerDeps,
  debug?: ImportRunnerDebugConfig,
): Promise<Record<string, unknown>> {
  const emit = (event: string, attrs?: Record<string, unknown>) => {
    if (!debug?.enabled) return;
    debug.emit?.(event, attrs);
  };
  const emitProgress = async (
    phase: string,
    progressPercent: number,
    payload?: Record<string, unknown>,
  ) => {
    await broadcastProgress(deps, phase, progressPercent, {
      type: "MONEY_IMPORT_PROGRESS",
      debug_run_id: debug?.debugRunId ?? null,
      ...(payload ?? {}),
    });
  };

  const connector = deps.getConnector((session.source as string) ?? "");
  if (!connector) {
    throw new Error(`No connector for source: ${session.source}`);
  }

  const sessionWindowFrom =
    typeof session.window_from === "string" ? session.window_from : undefined;
  const sessionLastImportedAt =
    typeof session.last_imported_at === "string" ? session.last_imported_at : undefined;
  const windowTo = typeof session.window_to === "string" ? session.window_to : undefined;
  const windowFrom = windowFromInput || sessionWindowFrom || sessionLastImportedAt;
  const edgeAuth = resolveEdgeAuthToken(session);
  const payerPersonId =
    typeof session.payer_person_id === "string" ? session.payer_person_id.trim() : "";
  const defaultAccountId =
    typeof session.default_account_id === "string" && session.default_account_id.trim()
      ? session.default_account_id.trim()
      : null;
  emit("parse_started", {
    source: session.source as string,
    window_from: windowFrom ?? null,
    window_to: windowTo ?? null,
    tab_id: debug?.tabId ?? null,
  });
  const parseOutput = await connector.parse({
    source: session.source as string,
    windowFrom,
    windowTo,
    session,
    debug: {
      enabled: debug?.enabled,
      parse_only: debug?.parseOnly,
      tab_id: debug?.tabId,
      debug_run_id: debug?.debugRunId,
      session_id: typeof session.session_id === "string" ? session.session_id : undefined,
      on_progress: async (update) => {
        await emitProgress(update.phase, update.progress_percent, {
          parsed_transactions_count: update.parsed_transactions_count ?? null,
        });
      },
    },
  });
  emit("parse_completed", {
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
    extraction_method: parseOutput.debug?.extraction_method ?? null,
    fallback_used: parseOutput.debug?.fallback_used ?? null,
    fallback_reason: parseOutput.debug?.fallback_reason ?? null,
  });

  await emitProgress("parse_completed", 60, {
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
    connector_debug: parseOutput.debug ?? null,
  });

  if (debug?.parseOnly) {
    emit("complete_session_started", {
      parse_only: true,
    });
    emit("complete_session_completed", {
      parse_only: true,
    });
    const parseOnlyResult = {
      batch_id: session.batch_id ?? null,
      parse_only: true,
      parse_output: parseOutput,
      debug_run_id: debug.debugRunId ?? null,
    };
    await deps.broadcastToAppTabs(
      buildProgressMessage("parse_only_completed", 100, {
        type: "MONEY_IMPORT_DONE",
        batch_id: session.batch_id ?? null,
        parse_only: true,
        debug_run_id: debug.debugRunId ?? null,
      }),
    );
    return parseOnlyResult;
  }

  const edgeTarget = resolveEdgeTarget(session.function_url);
  emit("preview_rows_started", {
    row_count: parseOutput.rows.length,
    chunk_count: chunkPreviewRows(parseOutput.rows, PREVIEW_ROWS_CHUNK_SIZE).length,
    batch_id: (session.batch_id as string) ?? null,
    session_id: (session.session_id as string) ?? null,
    payer_person_id_present: payerPersonId.length > 0,
    edge_auth_mode: edgeAuth.token_mode,
    edge_action: "preview_rows",
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });
  const previewChunks = chunkPreviewRows(parseOutput.rows, PREVIEW_ROWS_CHUNK_SIZE);
  let applyResult: Record<string, unknown>;
  try {
    let previewBatchId =
      typeof session.batch_id === "string" && session.batch_id.trim() ? session.batch_id : null;
    let insertedTotal = 0;
    let skippedTotal = 0;
    let errorTotal = 0;

    for (let chunkIndex = 0; chunkIndex < previewChunks.length; chunkIndex += 1) {
      const rowsChunk = previewChunks[chunkIndex];
      const rowOffset = chunkIndex * PREVIEW_ROWS_CHUNK_SIZE;
      const isFinalChunk = chunkIndex === previewChunks.length - 1;

      await emitProgress(
        "preview_rows_started",
        resolvePreviewProgressPercent(chunkIndex, previewChunks.length),
        {
          batch_id: previewBatchId,
          chunk_index: chunkIndex,
          chunk_count: previewChunks.length,
          parsed_transactions_count: parseOutput.parsedTransactionsCount,
          parsed_through_at: parseOutput.parsedThroughAt,
        },
      );

      const chunkResult = await deps.callEdge(session.function_url as string, edgeAuth.token, {
        action: "preview_rows",
        session_id: session.session_id,
        batch_id: previewBatchId,
        payer_person_id: payerPersonId || null,
        default_account_id: defaultAccountId,
        window_from: windowFrom ?? null,
        window_to: windowTo ?? parseOutput.windowTo,
        parsed_through_at: parseOutput.parsedThroughAt,
        parsed_transactions_count: parseOutput.parsedTransactionsCount,
        chunk_index: chunkIndex,
        chunk_count: previewChunks.length,
        row_offset: rowOffset,
        is_final_chunk: isFinalChunk,
        total_row_count: parseOutput.rows.length,
        rows: rowsChunk,
      });

      const chunkBatchId =
        typeof chunkResult.batch_id === "string" && chunkResult.batch_id.trim()
          ? chunkResult.batch_id
          : null;
      previewBatchId = chunkBatchId ?? previewBatchId;
      insertedTotal +=
        typeof chunkResult.inserted === "number" && Number.isFinite(chunkResult.inserted)
          ? chunkResult.inserted
          : 0;
      skippedTotal +=
        typeof chunkResult.skipped === "number" && Number.isFinite(chunkResult.skipped)
          ? chunkResult.skipped
          : 0;
      errorTotal +=
        typeof chunkResult.error_count === "number" && Number.isFinite(chunkResult.error_count)
          ? chunkResult.error_count
          : 0;
    }

    applyResult = {
      batch_id: previewBatchId ?? session.batch_id ?? null,
      inserted: insertedTotal,
      skipped: skippedTotal,
      error_count: errorTotal,
    };
  } catch (error) {
    emit("preview_rows_failed", {
      ...extractErrorDetails(error),
      edge_auth_mode: edgeAuth.token_mode,
      edge_action: "preview_rows",
      edge_scheme: edgeTarget.scheme,
      edge_host: edgeTarget.host,
      edge_path: edgeTarget.path,
    });
    throw error;
  }
  emit("preview_rows_completed", {
    batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id ?? null,
    inserted:
      typeof (applyResult as { inserted?: unknown }).inserted === "number"
        ? ((applyResult as { inserted: number }).inserted ?? null)
        : null,
    skipped:
      typeof (applyResult as { skipped?: unknown }).skipped === "number"
        ? ((applyResult as { skipped: number }).skipped ?? null)
        : null,
    error_count:
      typeof (applyResult as { error_count?: unknown }).error_count === "number"
        ? ((applyResult as { error_count: number }).error_count ?? null)
        : null,
    edge_action: "preview_rows",
    edge_auth_mode: edgeAuth.token_mode,
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });

  emit("complete_session_started", {
    edge_action: "complete_session",
    edge_auth_mode: edgeAuth.token_mode,
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });
  await emitProgress("complete_session_started", 90, {
    batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id ?? null,
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
  });
  try {
    await deps.callEdge(session.function_url as string, edgeAuth.token, {
      action: "complete_session",
      session_id: session.session_id,
      batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id,
      status: "completed",
    });
  } catch (error) {
    emit("complete_session_failed", {
      ...extractErrorDetails(error),
      edge_action: "complete_session",
      edge_auth_mode: edgeAuth.token_mode,
      edge_scheme: edgeTarget.scheme,
      edge_host: edgeTarget.host,
      edge_path: edgeTarget.path,
    });
    throw error;
  }
  emit("complete_session_completed", {
    edge_action: "complete_session",
    edge_auth_mode: edgeAuth.token_mode,
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });

  await deps.broadcastToAppTabs(
    buildProgressMessage("review_ready", 100, {
      type: "MONEY_IMPORT_DONE",
      batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id,
      debug_run_id: debug?.debugRunId ?? null,
      unattended: session.unattended === true,
    }),
  );

  return {
    ...applyResult,
    // Read back out by a scheduled run, which must not walk its cursor past a window it only
    // saw part of. Derived here rather than sent anywhere: the server is told nothing new.
    import_completeness: readRunCompleteness(parseOutput.debug),
  };
}

export interface RunCompleteness {
  /** Receipts this run left unread, for any reason: budget, rate limit, or outright failure. */
  unread_receipt_count: number;
  /** True when the connector could not prove it read the whole window. */
  partial: boolean;
}

/**
 * What a finished run is able to say about how much of its window it actually read.
 *
 * Only what the connector reports today is read here. Receipt budget is the signal that fires
 * in practice: a month-sized slice routinely exhausts it, and those operations come back
 * without their receipts. `partial` currently has one source -- a blocked page -- and gains the
 * truncation counters when the milestone that detects them lands; both feed
 * `shouldAdvanceBackfillCursor`, so nothing here changes when they arrive.
 */
function readRunCompleteness(debug: ConnectorParseDebugSummary | undefined): RunCompleteness {
  const receipts = debug?.receipt_enrichment;
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  // Every way a receipt can go unread counts, not the budget alone. A slice whose last receipt
  // was rate-limited reports `skipped_after_budget_count: 0` -- there were no later requests to
  // increment it -- and reading that as "complete" advances the cursor past rows that never got
  // their detail, on a walk that passes each slice once.
  const unreadReceiptCount =
    count(receipts?.skipped_after_budget_count) +
    count(receipts?.rate_limited_count) +
    count(receipts?.failed_count);

  return {
    unread_receipt_count: unreadReceiptCount,
    partial: Boolean(debug?.blocked_reason) || receipts?.stopped_after_budget === true,
  };
}

export interface ScheduledImportCredentials {
  /** Long-lived grant the extension holds; the normal path for an unattended run. */
  grantToken?: string;
  /** A user access token, used when a run is started from the app instead. */
  userAccessToken?: string;
}

export interface ScheduledImportInput {
  sourceId: string;
  payerPersonId: string;
  nowMs: number;
  functionUrl: string;
  credentials: ScheduledImportCredentials;
  defaultAccountId?: string | null;
  appOrigin?: string | null;
  showSourcePageWidget?: boolean;
  /**
   * The bank tab to work in. Required, and not merely helpful: given no tab the connector falls
   * back to the active tab of the last focused window, which during an unattended sweep is
   * whatever the person happens to be reading -- and it is then rejected for not being a bank
   * page, so the tab the sweep opened for itself goes unused.
   */
  tabId: number;
}

export interface ScheduledImportRunResult {
  window: BackfillSlice;
  result: Record<string, unknown>;
}

export interface ScheduledImportOutcome {
  incremental: ScheduledImportRunResult | null;
  backfill: ScheduledImportRunResult | null;
  /** Set when the history slice failed. The catch-up window's own result still stands. */
  backfillError?: { window: BackfillSlice; message: string };
}

function readCompletenessFromResult(result: Record<string, unknown>): {
  unreadReceiptCount: number;
  partial: boolean;
} {
  const value = result.import_completeness;
  if (!value || typeof value !== "object") {
    // A result without the summary is a result that cannot vouch for its window. Reading that
    // silence as "complete" is what would quietly skip a slice, so it counts as partial.
    return { unreadReceiptCount: 0, partial: true };
  }
  const record = value as Record<string, unknown>;
  const unread = record.unread_receipt_count;
  return {
    unreadReceiptCount: typeof unread === "number" && Number.isFinite(unread) ? unread : 0,
    partial: record.partial === true,
  };
}

/**
 * Takes the session field for this run, or refuses when someone else already holds it.
 *
 * There is no atomic test-and-set over extension storage, and none is needed here: the service
 * worker is single-threaded and this read and write are separated by no other await, so nothing
 * of ours can interleave. What it guards is the app having stored a session while the sweep was
 * busy with an earlier window -- the check at the start of a sweep is a snapshot, and the second
 * window happens long after it.
 */
async function claimSessionField(
  sessionStore: SessionStore,
  session: Record<string, unknown>,
): Promise<boolean> {
  const current = await sessionStore.getSession();
  if (current) {
    const currentId = typeof current.session_id === "string" ? current.session_id : null;
    const ownId = typeof session.session_id === "string" ? session.session_id : null;
    if (!currentId || !ownId || currentId !== ownId) return false;
  }
  await sessionStore.setSession(session);
  return true;
}

/**
 * Clears the stored session, but only while it is still the one this run put there.
 *
 * An unattended run and a person can want the session field at the same time: the app stores a
 * session with `MONEY_IMPORT_START_SESSION` and reads it back on `MONEY_IMPORT_RUN`, so a sweep
 * clearing the field unconditionally between those two would fail the person's import with "no
 * active import session" for reasons on nobody's screen.
 */
async function clearOwnSession(
  sessionStore: SessionStore,
  session: Record<string, unknown>,
): Promise<void> {
  const current = await sessionStore.getSession();
  const currentId = typeof current?.session_id === "string" ? current.session_id : null;
  const ownId = typeof session.session_id === "string" ? session.session_id : null;
  if (currentId && ownId && currentId !== ownId) return;
  await sessionStore.setSession(null);
}

/**
 * One unattended visit: catch up on the last few days, then take one month-sized bite out of
 * the history.
 *
 * Each window gets its own import session. `runImportSession` finishes by completing the
 * session it was given, and the server only accepts sessions that are neither revoked nor
 * finished -- so reusing one across both windows would fail on the second window's first
 * request. Separate sessions also read better on the import history screen, where the catch-up
 * and the history slice show up as the two different things they are.
 */
/** Receipt strategy for a run nobody is watching: slower, and complete. */
const UNATTENDED_PARSE_STRATEGY: ConnectorParseStrategy = "full";

/**
 * The strategy an unattended run states for this connector: the slow, complete one where the
 * connector tells strategies apart, nothing where it does not. Stating `full` to a connector
 * that ignores it changed nothing about the parse and everything about the session -- the
 * server pays a full parse with a four-hour token, and Alfa's sweep was collecting one for a
 * fifteen-minute run.
 */
function unattendedParseStrategy(connector: Connector | null): ConnectorParseStrategy | null {
  return connector?.parseStrategies?.includes(UNATTENDED_PARSE_STRATEGY)
    ? UNATTENDED_PARSE_STRATEGY
    : null;
}

export async function runScheduledImport(
  input: ScheduledImportInput,
  deps: ImportRunnerDeps & { backfillStore: BackfillStore; sessionStore: SessionStore },
  debug?: ImportRunnerDebugConfig,
): Promise<ScheduledImportOutcome> {
  const token = input.credentials.grantToken ?? input.credentials.userAccessToken ?? "";
  if (!token) throw new Error("No credentials available for a scheduled import");

  const windowDebug: ImportRunnerDebugConfig = { ...(debug ?? {}), tabId: input.tabId };
  // Nobody is waiting on this tab, so it pays the bank's rate limit with time instead of with
  // receipts. The fast strategy shares one retry budget across the run and skips every receipt
  // after it is spent: the first live run lost 45 of 177 that way.
  const parseStrategy = unattendedParseStrategy(deps.getConnector(input.sourceId));
  const parseStrategyFields = parseStrategy ? { parse_strategy: parseStrategy } : {};

  const runWindow = async (window: BackfillSlice): Promise<ScheduledImportRunResult> => {
    const created = await deps.callEdge(input.functionUrl, token, {
      action: "create_session",
      source: input.sourceId,
      payer_person_id: input.payerPersonId,
      window_from: window.windowFromIso,
      window_to: window.windowToIso,
      meta: {
        ...parseStrategyFields,
        // Kept on the batch, so the history screen can say which imports nobody started.
        unattended: true,
      },
    });

    const session: Record<string, unknown> = {
      ...created,
      // Deliberately absent unless the caller has one: the grant is spent on `create_session`
      // and every later request runs on the short-lived session token it handed back, which is
      // what keeps a long-lived credential off the rest of the conversation.
      user_access_token: input.credentials.userAccessToken ?? null,
      function_url: input.functionUrl,
      default_account_id: input.defaultAccountId ?? null,
      app_origin: input.appOrigin ?? null,
      show_source_page_widget: input.showSourcePageWidget ?? false,
      // Stated from the plan rather than taken from the server's echo. The connector reads its
      // upper bound from here, and a slice that silently loses its end is a slice that reads
      // through to today -- the difference between a bounded walk and one that grows every run.
      window_from: window.windowFromIso,
      window_to: window.windowToIso,
      // Stated here as well, for a server that does not echo it.
      ...parseStrategyFields,
      // The app navigates to the report on MONEY_IMPORT_DONE. That is right for a run someone
      // started and wrong for one they did not: it would take a person off whatever they were
      // doing -- including a manual import in progress -- and onto a report for a run they never
      // asked for. The flag rides on the session so every message the run broadcasts carries it.
      unattended: true,
    };
    // Checked immediately before the write, not once at the start of the sweep: the app can
    // store a session at any moment, and overwriting one costs the person their import. The
    // window's own session is completed as failed rather than left running.
    const claimed = await claimSessionField(deps.sessionStore, session);
    if (!claimed) {
      await tryCompleteSessionAsFailed(session, deps.callEdge);
      throw new Error("A session started by the person is in progress");
    }

    try {
      const result = await runImportSession(session, window.windowFromIso, deps, windowDebug);
      return { window, result };
    } catch (error) {
      // Same duty the manual path takes: a run that dies mid-window leaves a session the server
      // still counts as running, and nobody is here to notice. Failing to say so is how the
      // import history fills with runs that never ended.
      await tryCompleteSessionAsFailed(session, deps.callEdge);
      throw error;
    } finally {
      await clearOwnSession(deps.sessionStore, session);
    }
  };

  const scope = { sourceId: input.sourceId, payerPersonId: input.payerPersonId };
  const state = await deps.backfillStore.getState(scope);

  const incremental = await runWindow(planIncrementalWindow(state, input.nowMs));
  // Recorded only once the window has actually landed, so a failed run leaves the next one
  // reaching just as far back rather than skipping what it never read.
  await deps.backfillStore.setState(scope, { ...state, lastIncrementalToMs: input.nowMs });
  const planned = planBackfillSlice(state, input.nowMs);
  if (!planned) {
    // The walk has reached its horizon; from here only the catch-up window matters.
    if (state.completedAtMs === null) {
      await deps.backfillStore.setState(scope, {
        ...state,
        lastIncrementalToMs: input.nowMs,
        completedAtMs: input.nowMs,
      });
    }
    return { incremental, backfill: null };
  }

  let backfill: ScheduledImportRunResult;
  try {
    backfill = await runWindow(planned.slice);
  } catch (error) {
    // A failed history slice must not cost the catch-up window that already succeeded, and must
    // not move the cursor: the same slice is simply taken again next time. It is reported rather
    // than swallowed -- a bare null made a failing slice indistinguishable from a finished walk,
    // so a connector that had stopped working could retry for weeks with nothing to say so.
    return {
      incremental,
      backfill: null,
      backfillError: {
        window: planned.slice,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (shouldAdvanceBackfillCursor({ ok: true, ...readCompletenessFromResult(backfill.result) })) {
    await deps.backfillStore.setState(scope, {
      ...planned.nextState,
      lastIncrementalToMs: input.nowMs,
    });
  }

  return { incremental, backfill };
}

export async function tryCompleteSessionAsFailed(
  session: Record<string, unknown>,
  callEdge: ImportRunnerDeps["callEdge"],
): Promise<void> {
  try {
    const edgeAuth = resolveEdgeAuthToken(session);
    await callEdge(session.function_url as string, edgeAuth.token, {
      action: "complete_session",
      session_id: session.session_id,
      batch_id: session.batch_id,
      status: "failed",
    });
  } catch {
    // Ignore completion failures; original error is still reported to UI.
  }
}
