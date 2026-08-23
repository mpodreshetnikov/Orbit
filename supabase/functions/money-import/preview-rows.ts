import { isSessionUsable } from "./auth.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import {
  buildReceiptPersistenceFields,
  buildLineItemImportHash,
  extractAccountHintFromRow,
  jsonResponse,
  normalizeLineItems,
  normalizeSourceForTransactions,
  normalizeText,
  normalizeTransactionRow,
  toIsoOrNull,
  toNumberOrNull,
} from "./normalize.ts";
import {
  classifyRowForWindow,
  mergeRangeMeta,
  resolveEffectiveImportWindow,
} from "./range-window.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type {
  AuthContext,
  BatchBrandResolutionInput,
  CanonicalTransactionRowInput,
  RowStatus,
} from "./types.ts";

export interface PreviewRowsDeps {
  repository: MoneyImportRepository;
  now?: () => Date;
  telemetry?: EdgeTelemetry;
}

type RowErrorSignature =
  | "no_account_for_source"
  | "duplicate_transaction"
  | "validation_error"
  | "other";

function normalizeErrorMessageForTelemetry(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157)}...`;
}

function classifyRowErrorSignature(message: string): RowErrorSignature {
  const normalized = message.toLowerCase();
  if (normalized.includes("no money account found for source")) return "no_account_for_source";
  if (normalized.includes("duplicate transaction")) return "duplicate_transaction";
  if (normalized.includes("invalid posted_at") || normalized.includes("invalid amount")) {
    return "validation_error";
  }
  return "other";
}

function accountCacheKeyForRow(row: CanonicalTransactionRowInput, fallbackSource: string): string {
  const explicitAccountId = normalizeText(row.account_id);
  if (explicitAccountId) return `explicit:${explicitAccountId}`;

  const accountHint = extractAccountHintFromRow(row);
  const rowSource = normalizeSourceForTransactions(normalizeText(row.source) ?? fallbackSource);
  if (accountHint) return `${rowSource}|hint:${accountHint}`;

  const externalId = normalizeText(row.external_id);
  if (externalId) return `${rowSource}|external:${externalId}`;

  return `${rowSource}|posted:${row.posted_at}|amount:${toNumberOrNull(row.amount) ?? "none"}`;
}

function brandCacheKeyForRow(
  row: CanonicalTransactionRowInput,
  fallbackSource: string,
): string | null {
  const sourceBrand =
    row.source_brand && typeof row.source_brand === "object"
      ? (row.source_brand as Record<string, unknown>)
      : null;
  const sourceKey =
    typeof sourceBrand?.source_key === "string" && sourceBrand.source_key.trim().length > 0
      ? sourceBrand.source_key.trim()
      : typeof sourceBrand?.name === "string" && sourceBrand.name.trim().length > 0
        ? sourceBrand.name.trim()
        : null;
  if (!sourceKey) return null;
  const source = normalizeSourceForTransactions(normalizeText(row.source) ?? fallbackSource);
  return `${source}|${sourceKey}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function toNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function readChunkState(
  body: Record<string, unknown>,
  rowCount: number,
): {
  enabled: boolean;
  chunkIndex: number;
  chunkCount: number;
  rowOffset: number;
  isFinalChunk: boolean;
  totalRowCount: number | null;
} {
  const hasChunkMetadata =
    "chunk_index" in body ||
    "chunk_count" in body ||
    "row_offset" in body ||
    "is_final_chunk" in body ||
    "total_row_count" in body;
  if (!hasChunkMetadata) {
    return {
      enabled: false,
      chunkIndex: 0,
      chunkCount: 1,
      rowOffset: 0,
      isFinalChunk: true,
      totalRowCount: rowCount,
    };
  }

  const chunkIndex = toNonNegativeInteger(body.chunk_index, 0);
  const chunkCount = Math.max(1, toNonNegativeInteger(body.chunk_count, 1));
  const rowOffset = toNonNegativeInteger(body.row_offset, 0);
  const totalRowCount = Math.max(
    rowOffset + rowCount,
    toNonNegativeInteger(body.total_row_count, rowOffset + rowCount),
  );

  return {
    enabled: true,
    chunkIndex,
    chunkCount,
    rowOffset,
    isFinalChunk:
      typeof body.is_final_chunk === "boolean" ? body.is_final_chunk : chunkIndex >= chunkCount - 1,
    totalRowCount,
  };
}

function buildPreviewResetMeta(
  existingMetaInput: unknown,
  incomingMetaInput: unknown,
): Record<string, unknown> {
  const incomingMeta = asRecord(incomingMetaInput);
  const existingMeta = asRecord(existingMetaInput);
  const incomingRangeSelectionMeta = asRecord(incomingMeta?.range_selection_meta);
  const existingRangeSelectionMeta = asRecord(existingMeta?.range_selection_meta);

  return {
    range_selection_meta: incomingRangeSelectionMeta ?? existingRangeSelectionMeta ?? null,
  };
}

export async function previewRowsAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: PreviewRowsDeps,
): Promise<Response> {
  const actionSpan = deps.telemetry?.startSpan("edge.money_import.preview_rows");
  const rowsRaw = body.rows;
  if (!Array.isArray(rowsRaw)) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "rows must be an array",
    });
    return jsonResponse({ error: "rows must be an array" }, 400);
  }

  let source = normalizeText(body.source) ?? "manual";
  let payerPersonId = normalizeText(body.payer_person_id);
  let defaultAccountId = normalizeText(body.default_account_id);
  let importType = normalizeText(body.import_type) ?? "file";
  let batchId = normalizeText(body.batch_id);
  let sessionId = normalizeText(body.session_id);
  // Batch ownership follows the human behind the request: the signed-in user directly, or
  // the user the import session was created for.
  let createdByAuthUserId = auth.mode === "user" ? auth.userId : null;

  if (auth.mode === "session") {
    const session = auth.session;
    if (!isSessionUsable(session)) {
      await actionSpan?.end({
        status: "error",
        statusMessage: "Import session expired or revoked",
      });
      return jsonResponse({ error: "Import session expired or revoked" }, 401);
    }

    const sessionStatus = normalizeText(session.status) ?? "";
    source = normalizeText(session.source) ?? source;
    payerPersonId = normalizeText(session.payer_person_id) ?? payerPersonId;
    defaultAccountId = normalizeText(session.default_account_id) ?? defaultAccountId;
    batchId = normalizeText(session.batch_id) ?? batchId;
    sessionId = normalizeText(session.id) ?? sessionId;
    createdByAuthUserId = normalizeText(session.created_by_auth_user_id) ?? createdByAuthUserId;
    importType = "web_export";

    if (sessionStatus === "created" && sessionId) {
      await deps.repository.updateImportSession(sessionId, {
        status: "running",
        updated_at: (deps.now ?? (() => new Date()))().toISOString(),
      });
    }
  }

  if (!payerPersonId) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "payer_person_id is required",
    });
    return jsonResponse({ error: "payer_person_id is required" }, 400);
  }

  const transactionSourceFallback = normalizeSourceForTransactions(source);
  const chunkState = readChunkState(body, rowsRaw.length);
  const { windowFrom: windowFromInput, windowTo: windowToInput } = resolveEffectiveImportWindow(
    auth.mode === "session" ? auth.session.window_from : body.window_from,
    auth.mode === "session" ? auth.session.window_to : body.window_to,
    body.window_from,
    body.window_to,
  );

  if (!batchId) {
    batchId = await deps.repository.createImportBatch({
      source,
      payer_person_id: payerPersonId,
      import_type: importType,
      file_path: normalizeText(body.file_path),
      meta: body.meta ?? null,
      session_id: sessionId,
      status: "running",
      window_from: windowFromInput,
      window_to: windowToInput,
      created_by_auth_user_id: createdByAuthUserId,
    });

    if (sessionId) {
      await deps.repository.updateImportSession(sessionId, {
        batch_id: batchId,
        updated_at: (deps.now ?? (() => new Date()))().toISOString(),
      });
    }
  }

  const batchBefore = await deps.repository.getImportBatch(batchId);
  if (!batchBefore) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch not found",
    });
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  const existingStatus = normalizeText(batchBefore.status);
  if (existingStatus === "completed" || existingStatus === "discarded") {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch is not awaiting preview",
    });
    return jsonResponse({ error: "Batch is not awaiting preview" }, 409);
  }

  // Chunk zero clears everything parsed so far. A retried or replayed chunk zero — a
  // background script restart, a resent request — would otherwise erase chunks that already
  // landed and leave the counters describing rows that are no longer there. The attempt id
  // is generated once per run by the caller, so a repeat of the same attempt is recognised
  // as a repeat rather than as a new run.
  const previewAttemptId = normalizeText(body.preview_attempt_id);
  const storedPreviewAttemptId = normalizeText(asRecord(batchBefore.meta)?.preview_attempt_id);
  const isFirstChunk = !chunkState.enabled || chunkState.chunkIndex === 0;
  const isPreviewAttemptRepeat =
    previewAttemptId !== null && previewAttemptId === storedPreviewAttemptId;
  const shouldResetPreview = isFirstChunk && !isPreviewAttemptRepeat;
  if (shouldResetPreview) {
    await deps.repository.deleteReportRowsByBatch(batchId);
    if (deps.repository.deleteBatchBrandResolutionsByBatch) {
      await deps.repository.deleteBatchBrandResolutionsByBatch(batchId);
    }
  }

  const accumulatedInsertedBefore =
    chunkState.enabled && !shouldResetPreview
      ? toNonNegativeInteger(batchBefore.inserted_count, 0)
      : 0;
  const accumulatedSkippedBefore =
    chunkState.enabled && !shouldResetPreview
      ? toNonNegativeInteger(batchBefore.skipped_count, 0)
      : 0;
  const accumulatedErrorBefore =
    chunkState.enabled && !shouldResetPreview
      ? toNonNegativeInteger(batchBefore.error_count, 0)
      : 0;
  const batchMetaBase = shouldResetPreview
    ? buildPreviewResetMeta(batchBefore.meta, body.meta)
    : batchBefore.meta;
  const sessionMetaBase = shouldResetPreview
    ? buildPreviewResetMeta(auth.mode === "session" ? auth.session.meta : null, body.meta)
    : auth.mode === "session"
      ? auth.session.meta
      : null;

  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let inRangeRowCount = 0;
  let filteredOutOfRangeCount = 0;
  let filteredInvalidDateCount = 0;
  const rowErrorSignatureCounts: Record<RowErrorSignature, number> = {
    no_account_for_source: 0,
    duplicate_transaction: 0,
    validation_error: 0,
    other: 0,
  };
  const errorMessageCounts = new Map<string, number>();
  let firstNoAccountWarningSent = false;
  const rowResults: Array<Record<string, unknown>> = [];
  const accountResolutionCache = new Map<string, string>();
  const brandResolutionCache = new Map<string, BatchBrandResolutionInput | null>();

  const registerFailureSignature = (
    message: string,
    rowIndex: number,
    row: CanonicalTransactionRowInput | null,
  ) => {
    const signature = classifyRowErrorSignature(message);
    rowErrorSignatureCounts[signature] += 1;
    const normalizedMessage = normalizeErrorMessageForTelemetry(message);
    errorMessageCounts.set(normalizedMessage, (errorMessageCounts.get(normalizedMessage) ?? 0) + 1);

    if (!firstNoAccountWarningSent && signature === "no_account_for_source") {
      firstNoAccountWarningSent = true;
      deps.telemetry?.warn("money_import_preview_rows_no_account_for_source", {
        row_index: rowIndex,
        source: normalizeSourceForTransactions(
          normalizeText(row?.source) ?? transactionSourceFallback,
        ),
      });
    }
  };

  for (let rowIndex = 0; rowIndex < rowsRaw.length; rowIndex++) {
    const raw = rowsRaw[rowIndex] as CanonicalTransactionRowInput;
    const absoluteRowIndex = chunkState.rowOffset + rowIndex;
    const rowSpan = deps.telemetry?.startSpan("edge.money_import.preview_rows.row", {
      attrs: { row_index: absoluteRowIndex },
    });

    try {
      const accountCacheKey = accountCacheKeyForRow(raw, transactionSourceFallback);
      let resolvedAccountId = accountResolutionCache.get(accountCacheKey) ?? null;
      if (!resolvedAccountId) {
        resolvedAccountId = await deps.repository.resolveAccountIdForRow(
          payerPersonId,
          raw,
          transactionSourceFallback,
          defaultAccountId,
        );
        accountResolutionCache.set(accountCacheKey, resolvedAccountId);
      }

      const rawRangeDecision = classifyRowForWindow(raw.posted_at, windowFromInput, windowToInput);
      if (rawRangeDecision.kind === "invalid_date") {
        errorCount += 1;
        filteredInvalidDateCount += 1;
        registerFailureSignature(rawRangeDecision.message, absoluteRowIndex, raw);

        await deps.repository.insertReportRow({
          batch_id: batchId,
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: absoluteRowIndex,
          source_line_index: null,
          status: "error",
          message: rawRangeDecision.message,
          transaction_id: null,
          line_item_id: null,
          ...buildReceiptPersistenceFields(raw),
          payload: rowsRaw[rowIndex] as Record<string, unknown>,
        });

        rowResults.push({
          idx: absoluteRowIndex,
          status: "error",
          message: rawRangeDecision.message,
          transaction_id: null,
        });
        await rowSpan?.end({
          status: "error",
          statusMessage: rawRangeDecision.message,
          attrs: { row_index: absoluteRowIndex, invalid_date: true },
        });
        continue;
      }

      const normalizedBase = normalizeTransactionRow(
        { ...raw, account_id: resolvedAccountId },
        transactionSourceFallback,
      );
      const brandCacheKey = brandCacheKeyForRow(normalizedBase, transactionSourceFallback);
      let brandResolution = brandCacheKey ? brandResolutionCache.get(brandCacheKey) : undefined;
      if (brandResolution === undefined && deps.repository.previewBrandResolutionForRow) {
        brandResolution =
          (await deps.repository.previewBrandResolutionForRow(
            normalizedBase,
            transactionSourceFallback,
          )) ?? null;
        if (brandCacheKey) {
          brandResolutionCache.set(brandCacheKey, brandResolution);
        }
      }
      if (brandResolution && deps.repository.upsertBatchBrandResolution) {
        await deps.repository.upsertBatchBrandResolution(batchId, brandResolution);
      }
      const resolvedCardId = await deps.repository.resolveCardIdForRow(
        resolvedAccountId,
        normalizedBase,
        true,
      );
      const resolvedBrandId =
        brandResolution?.suggested_reason === "existing_alias"
          ? normalizeText(brandResolution.selected_brand_id)
          : null;
      const normalized: CanonicalTransactionRowInput = {
        ...normalizedBase,
        card_id: resolvedCardId,
        brand_id: resolvedBrandId,
      };
      const rangeDecision = classifyRowForWindow(
        normalized.posted_at,
        windowFromInput,
        windowToInput,
      );
      if (rangeDecision.kind === "out_of_range") {
        skippedCount += 1;
        filteredOutOfRangeCount += 1;

        await deps.repository.insertReportRow({
          batch_id: batchId,
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: absoluteRowIndex,
          source_line_index: null,
          status: "skipped",
          message: rangeDecision.message,
          transaction_id: null,
          line_item_id: null,
          ...buildReceiptPersistenceFields(normalized),
          payload: normalized,
        });

        rowResults.push({
          idx: absoluteRowIndex,
          status: "skipped",
          message: rangeDecision.message,
          transaction_id: null,
        });
        await rowSpan?.end({
          status: "ok",
          attrs: {
            row_index: absoluteRowIndex,
            status: "skipped",
            filtered_by_range: true,
          },
        });
        continue;
      }
      inRangeRowCount += 1;

      const existingTransactionId = await deps.repository.findExistingTransactionId(
        normalized,
        payerPersonId,
      );
      const txStatus: RowStatus = existingTransactionId ? "skipped" : "inserted";
      const txMessage = existingTransactionId ? "Duplicate transaction" : null;
      if (txStatus === "inserted") insertedCount += 1;
      if (txStatus === "skipped") {
        skippedCount += 1;
        registerFailureSignature("Duplicate transaction", absoluteRowIndex, raw);
      }

      const txReportRowId = await deps.repository.insertReportRow({
        batch_id: batchId,
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: absoluteRowIndex,
        source_line_index: null,
        status: txStatus,
        message: txMessage,
        transaction_id: existingTransactionId,
        line_item_id: null,
        ...buildReceiptPersistenceFields(normalized),
        payload: normalized,
      });

      const lineItems = normalizeLineItems(normalized);
      const lineResults: Array<Record<string, unknown>> = [];
      const lineHashTxIdentity = existingTransactionId ?? `preview:${batchId}:${absoluteRowIndex}`;

      for (let lineIndex = 0; lineIndex < lineItems.length; lineIndex++) {
        const lineItem = lineItems[lineIndex];

        try {
          const importHash = await buildLineItemImportHash(lineHashTxIdentity, lineItem, lineIndex);
          let lineStatus: RowStatus = "inserted";
          let lineMessage: string | null = null;
          let lineItemId: string | null = null;

          if (existingTransactionId) {
            lineItemId = await deps.repository.findExistingLineItemId(
              existingTransactionId,
              importHash,
            );
            if (lineItemId) {
              lineStatus = "skipped";
              lineMessage = "Duplicate line item";
            }
          }

          await deps.repository.insertReportRow({
            batch_id: batchId,
            parent_row_id: txReportRowId,
            row_kind: "line_item",
            source_row_index: absoluteRowIndex,
            source_line_index: lineIndex,
            status: lineStatus,
            message: lineMessage,
            transaction_id: existingTransactionId,
            line_item_id: lineItemId,
            payload: { ...lineItem, import_hash: importHash },
          });

          lineResults.push({
            line_index: lineIndex,
            status: lineStatus,
            message: lineMessage,
            line_item_id: lineItemId,
          });
        } catch (lineError) {
          const lineMessage =
            lineError instanceof Error ? lineError.message : "Line item preview failed";
          errorCount += 1;
          registerFailureSignature(lineMessage, absoluteRowIndex, raw);

          await deps.repository.insertReportRow({
            batch_id: batchId,
            parent_row_id: txReportRowId,
            row_kind: "line_item",
            source_row_index: absoluteRowIndex,
            source_line_index: lineIndex,
            status: "error",
            message: lineMessage,
            transaction_id: existingTransactionId,
            line_item_id: null,
            payload: lineItem,
          });

          lineResults.push({
            line_index: lineIndex,
            status: "error",
            message: lineMessage,
            line_item_id: null,
          });
        }
      }

      rowResults.push({
        idx: absoluteRowIndex,
        status: txStatus,
        message: txMessage,
        transaction_id: existingTransactionId,
        line_results: lineResults,
      });
      await rowSpan?.end({
        status: "ok",
        attrs: {
          row_index: absoluteRowIndex,
          status: txStatus,
          line_item_count: lineResults.length,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview row failed";
      errorCount += 1;
      registerFailureSignature(message, absoluteRowIndex, raw);

      await deps.repository.insertReportRow({
        batch_id: batchId,
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: absoluteRowIndex,
        source_line_index: null,
        status: "error",
        message,
        transaction_id: null,
        line_item_id: null,
        ...buildReceiptPersistenceFields(raw),
        payload: rowsRaw[rowIndex] as Record<string, unknown>,
      });

      rowResults.push({
        idx: absoluteRowIndex,
        status: "error",
        message,
        transaction_id: null,
      });
      await rowSpan?.end({
        status: "error",
        statusMessage: message,
        attrs: { row_index: absoluteRowIndex },
      });
    }
  }

  const parsedCountInput = toNumberOrNull(body.parsed_transactions_count);
  const parsedThroughInput = toIsoOrNull(body.parsed_through_at);
  const parsedTransactionsCount = parsedCountInput ?? chunkState.totalRowCount ?? rowsRaw.length;
  const parsedThrough =
    parsedThroughInput ??
    (rowsRaw.length > 0
      ? (rowsRaw
          .map((r) => toIsoOrNull((r as CanonicalTransactionRowInput).posted_at))
          .filter((value): value is string => Boolean(value))
          .sort()[0] ?? null)
      : null);

  const batchMeta = mergeRangeMeta(batchMetaBase, body.meta, {
    parsedRowCount: rowsRaw.length,
    inRangeRowCount,
    filteredOutOfRangeCount,
    filteredInvalidDateCount,
  });
  if (previewAttemptId) batchMeta.preview_attempt_id = previewAttemptId;

  const patch: Record<string, unknown> = {
    parsed_transactions_count: parsedTransactionsCount,
    inserted_count: accumulatedInsertedBefore + insertedCount,
    skipped_count: accumulatedSkippedBefore + skippedCount,
    error_count: accumulatedErrorBefore + errorCount,
    status: chunkState.enabled && !chunkState.isFinalChunk ? "running" : "pending",
    completed_at: null,
    meta: batchMeta,
  };
  if (parsedThrough) patch.parsed_through_at = parsedThrough;
  if (windowFromInput) patch.window_from = windowFromInput;
  if (windowToInput) patch.window_to = windowToInput;

  await deps.repository.updateImportBatch(batchId, patch);

  if (sessionId) {
    const sessionPatch: Record<string, unknown> = {
      status: "running",
      updated_at: (deps.now ?? (() => new Date()))().toISOString(),
    };
    if (windowFromInput) sessionPatch.window_from = windowFromInput;
    if (windowToInput) sessionPatch.window_to = windowToInput;
    sessionPatch.meta = mergeRangeMeta(sessionMetaBase, body.meta, {
      parsedRowCount: rowsRaw.length,
      inRangeRowCount,
      filteredOutOfRangeCount,
      filteredInvalidDateCount,
    });
    await deps.repository.updateImportSession(sessionId, sessionPatch);
  }

  const topErrorMessage =
    Array.from(errorMessageCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null;
  deps.telemetry?.info("money_import_preview_rows_completed", {
    batch_id: batchId,
    row_count: rowsRaw.length,
    chunk_index: chunkState.enabled ? chunkState.chunkIndex : null,
    chunk_count: chunkState.enabled ? chunkState.chunkCount : null,
    row_offset: chunkState.enabled ? chunkState.rowOffset : null,
    is_final_chunk: chunkState.enabled ? chunkState.isFinalChunk : null,
    inserted: insertedCount,
    skipped: skippedCount,
    error_count: errorCount,
    error_no_account_count: rowErrorSignatureCounts.no_account_for_source,
    error_duplicate_transaction_count: rowErrorSignatureCounts.duplicate_transaction,
    error_validation_count: rowErrorSignatureCounts.validation_error,
    error_other_count: rowErrorSignatureCounts.other,
    top_error_message: topErrorMessage,
  });
  await actionSpan?.end({
    status: "ok",
    attrs: {
      batch_id: batchId,
      row_count: rowsRaw.length,
      chunk_index: chunkState.enabled ? chunkState.chunkIndex : null,
      chunk_count: chunkState.enabled ? chunkState.chunkCount : null,
      inserted: insertedCount,
      skipped: skippedCount,
      error_count: errorCount,
    },
  });

  return jsonResponse({
    batch_id: batchId,
    inserted: insertedCount,
    skipped: skippedCount,
    error_count: errorCount,
    row_results: rowResults,
  });
}
