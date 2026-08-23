import type { Connector } from "../connectors/types.js";
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

export function createPreviewAttemptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

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
  // Generated once for the whole run and sent with every chunk. Chunk zero clears the rows
  // parsed so far, so the server needs to tell a genuinely new run from a retry of the same
  // one; without that, a replayed chunk zero would erase chunks that already landed.
  const previewAttemptId = createPreviewAttemptId();

  // A window that was only partly fetched must not look like a closed one. Recorded on the
  // batch so the review screen can warn, and so the backfill cursor knows not to move past
  // a slice it did not fully see.
  const importCompleteness = {
    partial: parseOutput.debug?.partial_result === true,
    truncation_unresolved_count: parseOutput.debug?.truncation_unresolved_count ?? 0,
    truncation_suspected_count: parseOutput.debug?.truncation_suspected_count ?? 0,
    range_split_count: parseOutput.debug?.range_split_count ?? 0,
    extraction_method: parseOutput.debug?.extraction_method ?? null,
  };

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
        preview_attempt_id: previewAttemptId,
        meta: { import_completeness: importCompleteness },
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
    }),
  );

  return {
    ...applyResult,
    // Carried out so a scheduled run can tell a finished slice from one that only got part
    // of the way, and hold the backfill cursor accordingly.
    import_completeness: importCompleteness,
    receipt_enrichment: {
      skipped_after_budget_count:
        parseOutput.debug?.receipt_enrichment?.skipped_after_budget_count ?? 0,
      stopped_after_budget: parseOutput.debug?.receipt_enrichment?.stopped_after_budget ?? false,
    },
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
  /** Receipts one run may fetch; the connector's own default applies when omitted. */
  maxReceiptsPerRun?: number;
  defaultAccountId?: string | null;
  appOrigin?: string | null;
  showSourcePageWidget?: boolean;
}

export interface ScheduledImportRunResult {
  window: BackfillSlice;
  result: Record<string, unknown>;
}

function readCompleteness(result: Record<string, unknown>): {
  skippedAfterBudgetCount: number;
  partial: boolean;
} {
  const completeness =
    result.import_completeness && typeof result.import_completeness === "object"
      ? (result.import_completeness as Record<string, unknown>)
      : {};
  const receipts =
    result.receipt_enrichment && typeof result.receipt_enrichment === "object"
      ? (result.receipt_enrichment as Record<string, unknown>)
      : {};
  const skipped = receipts.skipped_after_budget_count;
  return {
    skippedAfterBudgetCount: typeof skipped === "number" && Number.isFinite(skipped) ? skipped : 0,
    partial: completeness.partial === true,
  };
}

/**
 * One scheduled visit: catch up on the last few days, then take one month-sized bite out of
 * the history.
 *
 * Each window gets its own import session. `runImportSession` finishes by revoking the
 * session it was given, and the server only accepts sessions that are neither revoked nor
 * finished — so reusing one across both windows would fail on the second window's first
 * request. Separate sessions also read better on the import history screen, where the
 * catch-up and the history slice show up as two clearly different runs.
 */
export async function runScheduledImport(
  input: ScheduledImportInput,
  deps: ImportRunnerDeps & { backfillStore: BackfillStore; sessionStore: SessionStore },
  debug?: ImportRunnerDebugConfig,
): Promise<{
  incremental: ScheduledImportRunResult | null;
  backfill: ScheduledImportRunResult | null;
}> {
  const token = input.credentials.grantToken ?? input.credentials.userAccessToken ?? "";
  if (!token) throw new Error("No credentials available for a scheduled import");

  const createSessionForWindow = async (window: BackfillSlice) => {
    const created = await deps.callEdge(input.functionUrl, token, {
      action: "create_session",
      source: input.sourceId,
      payer_person_id: input.payerPersonId,
      window_from: window.windowFromIso,
      window_to: window.windowToIso,
      meta: {
        max_receipts_per_run: input.maxReceiptsPerRun ?? null,
        scheduled: true,
      },
    });

    const session: Record<string, unknown> = {
      ...created,
      user_access_token: input.credentials.userAccessToken ?? null,
      function_url: input.functionUrl,
      default_account_id: input.defaultAccountId ?? null,
      app_origin: input.appOrigin ?? null,
      show_source_page_widget: input.showSourcePageWidget ?? true,
      max_receipts_per_run: input.maxReceiptsPerRun ?? null,
    };
    await deps.sessionStore.setSession(session);
    return session;
  };

  const runWindow = async (window: BackfillSlice): Promise<ScheduledImportRunResult> => {
    const session = await createSessionForWindow(window);
    const result = await runImportSession(session, window.windowFromIso, deps, debug);
    return { window, result };
  };

  const incrementalWindow = planIncrementalWindow(input.nowMs);
  const incremental = await runWindow(incrementalWindow);

  const state = await deps.backfillStore.getState(input.sourceId);
  const planned = planBackfillSlice(state, input.nowMs);
  if (!planned) {
    // The walk has reached its horizon; from here only the catch-up window matters.
    if (state.completedAtMs === null) {
      await deps.backfillStore.setState(input.sourceId, {
        ...state,
        completedAtMs: input.nowMs,
      });
    }
    return { incremental, backfill: null };
  }

  let backfill: ScheduledImportRunResult | null = null;
  try {
    backfill = await runWindow(planned.slice);
  } catch {
    // A failed history slice must not cost the catch-up window, and must not move the
    // cursor: the same slice is simply taken again next time.
    return { incremental, backfill: null };
  }

  const outcome = readCompleteness(backfill.result);
  if (shouldAdvanceBackfillCursor({ ok: true, ...outcome })) {
    await deps.backfillStore.setState(input.sourceId, planned.nextState);
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
