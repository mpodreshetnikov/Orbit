import { isSessionUsable } from "./auth.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import {
  buildReceiptPersistenceFields,
  buildLineItemImportHash,
  extractAccountHintFromRow,
  hasRealImportLineItems,
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
import type { AuthContext, CanonicalTransactionRowInput, RowStatus } from "./types.ts";

interface ApplyRowsDeps {
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

export async function applyRowsAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: ApplyRowsDeps,
): Promise<Response> {
  const actionSpan = deps.telemetry?.startSpan("edge.money_import.apply_rows");
  const rowsRaw = body.rows;
  if (!Array.isArray(rowsRaw)) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "rows must be an array",
    });
    return jsonResponse({ error: "rows must be an array" }, 400);
  }
  deps.telemetry?.info("money_import_apply_rows_started", {
    row_count: rowsRaw.length,
  });

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

  // Ownership is checked on the path where the caller chose the batch. Under user auth `batchId`
  // came straight out of `body.batch_id`, and this function reaches the database with the service
  // role, so RLS protects nothing here: `getImportBatch` would happily return, and this action
  // would happily write into, a batch belonging to somebody else. Under session auth the id came
  // from the session, which is already bound to a person, and the session's own usability was
  // checked above — there is no id for the caller to choose.
  //
  // 404 rather than 403 on someone else's batch, matching the four actions that already do this:
  // a 403 would confirm that the batch exists.
  const batchBefore =
    auth.mode === "user"
      ? await deps.repository.getImportBatchForUser(batchId, auth.userId)
      : await deps.repository.getImportBatch(batchId);
  if (!batchBefore) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch not found",
    });
    return jsonResponse({ error: "Batch not found" }, 404);
  }

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
  const insertedLineItemIds: string[] = [];
  let categoryPipelineMeta: Record<string, unknown> | null = null;

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
      deps.telemetry?.warn("money_import_apply_rows_no_account_for_source", {
        row_index: rowIndex,
        source: normalizeSourceForTransactions(
          normalizeText(row?.source) ?? transactionSourceFallback,
        ),
      });
    }
  };

  for (let rowIndex = 0; rowIndex < rowsRaw.length; rowIndex++) {
    const raw = rowsRaw[rowIndex] as CanonicalTransactionRowInput;
    const rowSpan = deps.telemetry?.startSpan("edge.money_import.apply_rows.row", {
      attrs: {
        row_index: rowIndex,
      },
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
        registerFailureSignature(rawRangeDecision.message, rowIndex, raw);
        await deps.repository.insertReportRow({
          batch_id: batchId,
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: rowIndex,
          source_line_index: null,
          status: "error",
          message: rawRangeDecision.message,
          transaction_id: null,
          line_item_id: null,
          ...buildReceiptPersistenceFields(raw),
          payload: rowsRaw[rowIndex] as Record<string, unknown>,
        });
        rowResults.push({
          idx: rowIndex,
          status: "error",
          message: rawRangeDecision.message,
          transaction_id: null,
        });
        await rowSpan?.end({
          status: "error",
          statusMessage: rawRangeDecision.message,
          attrs: {
            row_index: rowIndex,
            invalid_date: true,
          },
        });
        continue;
      }

      const normalizedBase = normalizeTransactionRow(
        { ...raw, account_id: resolvedAccountId },
        transactionSourceFallback,
      );
      const resolvedCardId = await deps.repository.resolveCardIdForRow(
        resolvedAccountId,
        normalizedBase,
      );
      const resolvedBrandId = deps.repository.resolveBrandIdForRow
        ? await deps.repository.resolveBrandIdForRow(
            normalizedBase,
            transactionSourceFallback,
            true,
          )
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
          source_row_index: rowIndex,
          source_line_index: null,
          status: "skipped",
          message: rangeDecision.message,
          transaction_id: null,
          line_item_id: null,
          ...buildReceiptPersistenceFields(normalized),
          payload: normalized,
        });
        rowResults.push({
          idx: rowIndex,
          status: "skipped",
          message: rangeDecision.message,
          transaction_id: null,
        });
        await rowSpan?.end({
          status: "ok",
          attrs: {
            row_index: rowIndex,
            status: "skipped",
            filtered_by_range: true,
          },
        });
        continue;
      }
      inRangeRowCount += 1;
      const tx = await deps.repository.insertOrResolveTransaction(normalized, payerPersonId);

      const txStatus: RowStatus = tx.inserted ? "inserted" : "skipped";
      const txMessage = tx.inserted ? null : "Duplicate transaction";
      if (txStatus === "inserted") insertedCount += 1;
      if (txStatus === "skipped") {
        skippedCount += 1;
        registerFailureSignature("Duplicate transaction", rowIndex, raw);
      }

      const txReportRowId = await deps.repository.insertReportRow({
        batch_id: batchId,
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: rowIndex,
        source_line_index: null,
        status: txStatus,
        message: txMessage,
        transaction_id: tx.transactionId,
        line_item_id: null,
        ...buildReceiptPersistenceFields(normalized),
        payload: normalized,
      });

      const lineItems = normalizeLineItems(normalized);
      if (!tx.inserted && hasRealImportLineItems(lineItems)) {
        await deps.repository.repairExistingTransactionDetails(tx.transactionId, normalized);
      }
      const lineResults: Array<Record<string, unknown>> = [];

      for (let lineIndex = 0; lineIndex < lineItems.length; lineIndex++) {
        const lineItem = lineItems[lineIndex];

        try {
          const importHash = await buildLineItemImportHash(tx.transactionId, lineItem, lineIndex);
          const lineRes = await deps.repository.insertLineItemIfNew(
            tx.transactionId,
            lineItem,
            importHash,
            normalized.amount,
          );
          const lineStatus: RowStatus = lineRes.inserted ? "inserted" : "skipped";
          const lineMessage = lineRes.inserted ? null : "Duplicate line item";

          await deps.repository.insertReportRow({
            batch_id: batchId,
            parent_row_id: txReportRowId,
            row_kind: "line_item",
            source_row_index: rowIndex,
            source_line_index: lineIndex,
            status: lineStatus,
            message: lineMessage,
            transaction_id: tx.transactionId,
            line_item_id: lineRes.lineItemId,
            payload: { ...lineItem, import_hash: importHash },
          });

          lineResults.push({
            line_index: lineIndex,
            status: lineStatus,
            message: lineMessage,
            line_item_id: lineRes.lineItemId,
          });

          if (lineRes.inserted && lineRes.lineItemId) {
            insertedLineItemIds.push(lineRes.lineItemId);
          }
        } catch (lineError) {
          const lineMessage =
            lineError instanceof Error ? lineError.message : "Line item import failed";
          errorCount += 1;
          registerFailureSignature(lineMessage, rowIndex, raw);

          await deps.repository.insertReportRow({
            batch_id: batchId,
            parent_row_id: txReportRowId,
            row_kind: "line_item",
            source_row_index: rowIndex,
            source_line_index: lineIndex,
            status: "error",
            message: lineMessage,
            transaction_id: tx.transactionId,
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
        idx: rowIndex,
        status: txStatus,
        message: txMessage,
        transaction_id: tx.transactionId,
        line_results: lineResults,
      });
      await rowSpan?.end({
        status: "ok",
        attrs: {
          row_index: rowIndex,
          status: txStatus,
          line_item_count: lineResults.length,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import row failed";
      errorCount += 1;
      registerFailureSignature(message, rowIndex, raw);

      await deps.repository.insertReportRow({
        batch_id: batchId,
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: rowIndex,
        source_line_index: null,
        status: "error",
        message,
        transaction_id: null,
        line_item_id: null,
        ...buildReceiptPersistenceFields(raw),
        payload: rowsRaw[rowIndex] as Record<string, unknown>,
      });

      rowResults.push({
        idx: rowIndex,
        status: "error",
        message,
        transaction_id: null,
      });
      await rowSpan?.end({
        status: "error",
        statusMessage: message,
        attrs: {
          row_index: rowIndex,
        },
      });
    }
  }

  if (insertedLineItemIds.length > 0 && deps.repository.applyCategoryRulePipeline) {
    categoryPipelineMeta = {
      status: "applied",
      line_item_count: insertedLineItemIds.length,
    };
    try {
      await deps.repository.applyCategoryRulePipeline(
        insertedLineItemIds,
        payerPersonId,
        "import_auto",
      );
    } catch (error) {
      categoryPipelineMeta = {
        status: "failed",
        line_item_count: insertedLineItemIds.length,
        error_message: error instanceof Error ? error.message : "Unknown category pipeline error",
      };
      deps.telemetry?.warn("money_import_apply_rows_category_pipeline_failed", {
        line_item_count: insertedLineItemIds.length,
        error_message: error instanceof Error ? error.message : "Unknown category pipeline error",
      });
    }
  }

  const topErrorMessage =
    Array.from(errorMessageCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const parsedCountInput = toNumberOrNull(body.parsed_transactions_count);
  const parsedThroughInput = toIsoOrNull(body.parsed_through_at);

  const previousParsedCount = toNumberOrNull(batchBefore.parsed_transactions_count) ?? 0;
  const parsedTransactionsCount =
    parsedCountInput !== null
      ? Math.max(previousParsedCount, parsedCountInput)
      : previousParsedCount + rowsRaw.length;

  const existingInserted = toNumberOrNull(batchBefore.inserted_count) ?? 0;
  const existingSkipped = toNumberOrNull(batchBefore.skipped_count) ?? 0;
  const existingError = toNumberOrNull(batchBefore.error_count) ?? 0;
  const nextInserted = existingInserted + insertedCount;
  const nextSkipped = existingSkipped + skippedCount;
  const nextError = existingError + errorCount;

  const parsedThrough =
    parsedThroughInput ??
    (rowsRaw.length > 0
      ? (rowsRaw
          .map((r) => toIsoOrNull((r as CanonicalTransactionRowInput).posted_at))
          .filter((v): v is string => Boolean(v))
          .sort()[0] ?? null)
      : null);

  const mergedMeta = mergeRangeMeta(batchBefore.meta, body.meta, {
    parsedRowCount: rowsRaw.length,
    inRangeRowCount,
    filteredOutOfRangeCount,
    filteredInvalidDateCount,
  });
  if (categoryPipelineMeta) {
    mergedMeta.category_pipeline = categoryPipelineMeta;
  }

  const patch: Record<string, unknown> = {
    parsed_transactions_count: parsedTransactionsCount,
    inserted_count: nextInserted,
    skipped_count: nextSkipped,
    error_count: nextError,
    meta: mergedMeta,
  };

  const isSessionFlow = Boolean(sessionId);
  const shouldAutoComplete = !isSessionFlow && importType === "file";
  patch.status = shouldAutoComplete ? "completed" : "running";
  if (shouldAutoComplete) {
    patch.completed_at = (deps.now ?? (() => new Date()))().toISOString();
  }
  if (parsedThrough) patch.parsed_through_at = parsedThrough;
  if (windowFromInput) patch.window_from = windowFromInput;
  if (windowToInput) patch.window_to = windowToInput;

  try {
    await deps.repository.updateImportBatch(batchId, patch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update batch";
    await actionSpan?.end({
      status: "error",
      statusMessage: message,
    });
    return jsonResponse(
      {
        error: message,
      },
      400,
    );
  }

  if (sessionId) {
    const sessionPatch: Record<string, unknown> = {
      status: "running",
      updated_at: (deps.now ?? (() => new Date()))().toISOString(),
    };
    if (windowFromInput) sessionPatch.window_from = windowFromInput;
    if (windowToInput) sessionPatch.window_to = windowToInput;
    const sessionMeta = mergeRangeMeta(
      auth.mode === "session" ? auth.session.meta : null,
      body.meta,
      {
        parsedRowCount: rowsRaw.length,
        inRangeRowCount,
        filteredOutOfRangeCount,
        filteredInvalidDateCount,
      },
    );
    if (categoryPipelineMeta) {
      sessionMeta.category_pipeline = categoryPipelineMeta;
    }
    sessionPatch.meta = sessionMeta;
    await deps.repository.updateImportSession(sessionId, sessionPatch);
  }
  deps.telemetry?.info("money_import_apply_rows_completed", {
    batch_id: batchId,
    row_count: rowsRaw.length,
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
      inserted: insertedCount,
      skipped: skippedCount,
      error_count: errorCount,
      error_no_account_count: rowErrorSignatureCounts.no_account_for_source,
      error_duplicate_transaction_count: rowErrorSignatureCounts.duplicate_transaction,
      error_validation_count: rowErrorSignatureCounts.validation_error,
      error_other_count: rowErrorSignatureCounts.other,
      top_error_message: topErrorMessage,
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
