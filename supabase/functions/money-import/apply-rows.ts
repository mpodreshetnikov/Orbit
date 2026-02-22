import { isSessionUsable } from "./auth.ts";
import {
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
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, CanonicalTransactionRowInput, RowStatus } from "./types.ts";

interface ApplyRowsDeps {
  repository: MoneyImportRepository;
  now?: () => Date;
}

function accountCacheKeyForRow(row: CanonicalTransactionRowInput, fallbackSource: string): string {
  const explicitAccountId = normalizeText(row.account_id);
  if (explicitAccountId) return `explicit:${explicitAccountId}`;

  const accountHint = extractAccountHintFromRow(row);
  const rowSource = normalizeSourceForTransactions(normalizeText(row.source) ?? fallbackSource);
  return `${rowSource}|${accountHint ?? "none"}`;
}

export async function applyRowsAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: ApplyRowsDeps,
): Promise<Response> {
  const rowsRaw = body.rows;
  if (!Array.isArray(rowsRaw)) {
    return jsonResponse({ error: "rows must be an array" }, 400);
  }

  let source = normalizeText(body.source) ?? "manual";
  let payerPersonId = normalizeText(body.payer_person_id);
  let importType = normalizeText(body.import_type) ?? "file";
  let batchId = normalizeText(body.batch_id);
  let sessionId = normalizeText(body.session_id);

  if (auth.mode === "session") {
    const session = auth.session;
    if (!isSessionUsable(session)) {
      return jsonResponse({ error: "Import session expired or revoked" }, 401);
    }

    const sessionStatus = normalizeText(session.status) ?? "";
    source = normalizeText(session.source) ?? source;
    payerPersonId = normalizeText(session.payer_person_id) ?? payerPersonId;
    batchId = normalizeText(session.batch_id) ?? batchId;
    sessionId = normalizeText(session.id) ?? sessionId;
    importType = "web_export";

    if (sessionStatus === "created" && sessionId) {
      await deps.repository.updateImportSession(sessionId, {
        status: "running",
        updated_at: (deps.now ?? (() => new Date()))().toISOString(),
      });
    }
  }

  if (!payerPersonId) {
    return jsonResponse({ error: "payer_person_id is required" }, 400);
  }

  const transactionSourceFallback = normalizeSourceForTransactions(source);
  const windowFromInput = toIsoOrNull(body.window_from);
  const windowToInput = toIsoOrNull(body.window_to);

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
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const rowResults: Array<Record<string, unknown>> = [];
  const accountResolutionCache = new Map<string, string>();

  for (let rowIndex = 0; rowIndex < rowsRaw.length; rowIndex++) {
    const raw = rowsRaw[rowIndex] as CanonicalTransactionRowInput;

    try {
      const accountCacheKey = accountCacheKeyForRow(raw, transactionSourceFallback);
      let resolvedAccountId = accountResolutionCache.get(accountCacheKey) ?? null;
      if (!resolvedAccountId) {
        resolvedAccountId = await deps.repository.resolveAccountIdForRow(
          payerPersonId,
          raw,
          transactionSourceFallback,
        );
        accountResolutionCache.set(accountCacheKey, resolvedAccountId);
      }

      const normalized = normalizeTransactionRow(
        { ...raw, account_id: resolvedAccountId },
        transactionSourceFallback,
      );
      const tx = await deps.repository.insertOrResolveTransaction(normalized, payerPersonId);

      const txStatus: RowStatus = tx.inserted ? "inserted" : "skipped";
      const txMessage = tx.inserted ? null : "Duplicate transaction";
      if (txStatus === "inserted") insertedCount += 1;
      if (txStatus === "skipped") skippedCount += 1;

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
        payload: normalized,
      });

      const lineItems = normalizeLineItems(normalized);
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
        } catch (lineError) {
          const lineMessage =
            lineError instanceof Error ? lineError.message : "Line item import failed";
          errorCount += 1;

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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import row failed";
      errorCount += 1;

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
        payload: rowsRaw[rowIndex] as Record<string, unknown>,
      });

      rowResults.push({
        idx: rowIndex,
        status: "error",
        message,
        transaction_id: null,
      });
    }
  }

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

  const patch: Record<string, unknown> = {
    parsed_transactions_count: parsedTransactionsCount,
    inserted_count: nextInserted,
    skipped_count: nextSkipped,
    error_count: nextError,
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
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Failed to update batch",
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
    await deps.repository.updateImportSession(sessionId, sessionPatch);
  }

  return jsonResponse({
    batch_id: batchId,
    inserted: insertedCount,
    skipped: skippedCount,
    error_count: errorCount,
    row_results: rowResults,
  });
}
