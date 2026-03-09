import type { EdgeTelemetry } from "../_shared/observability.ts";
import {
  buildLineItemImportHash,
  jsonResponse,
  normalizeLineItems,
  normalizeSourceForTransactions,
  normalizeText,
  normalizeTransactionRow,
  toIsoOrNull,
} from "./normalize.ts";
import {
  classifyRowForWindow,
  mergeRangeMeta,
  resolveEffectiveImportWindow,
} from "./range-window.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, CanonicalTransactionRowInput, RowStatus } from "./types.ts";

export interface ApplyBatchDeps {
  repository: MoneyImportRepository;
  now?: () => Date;
  telemetry?: EdgeTelemetry;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
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

export async function applyBatchAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: ApplyBatchDeps,
): Promise<Response> {
  const actionSpan = deps.telemetry?.startSpan("edge.money_import.apply_batch");
  const batchId = normalizeText(body.batch_id);
  if (!batchId) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "batch_id is required",
    });
    return jsonResponse({ error: "batch_id is required" }, 400);
  }

  if (auth.mode !== "user") {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Unauthorized",
    });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const batch = await deps.repository.getImportBatch(batchId);
  if (!batch) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch not found",
    });
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  if (normalizeText(batch.status) !== "pending") {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch is not awaiting review",
    });
    return jsonResponse({ error: "Batch is not awaiting review" }, 409);
  }

  const payerPersonId = normalizeText(batch.payer_person_id);
  if (!payerPersonId) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch payer is missing",
    });
    return jsonResponse({ error: "Batch payer is missing" }, 400);
  }

  const reportRows = await deps.repository.listReportRowsByBatch(batchId);
  const rowsRaw = reportRows
    .filter((row) => normalizeText(row.row_kind) === "transaction")
    .map((row) => ({
      raw: asRecord(row.payload) as unknown as CanonicalTransactionRowInput,
      status: normalizeText(row.status),
      message: normalizeText(row.message),
    }));
  const transactionSourceFallback = normalizeSourceForTransactions(
    normalizeText(batch.source) ?? "manual",
  );
  const { windowFrom: windowFromInput, windowTo: windowToInput } = resolveEffectiveImportWindow(
    batch.window_from,
    batch.window_to,
  );
  const batchBrandResolutions = deps.repository.listBatchBrandResolutions
    ? await deps.repository.listBatchBrandResolutions(batchId)
    : [];
  const brandResolutionByKey = new Map<string, Record<string, unknown>>();
  for (const resolution of batchBrandResolutions) {
    const resolutionSource = normalizeText(resolution.source);
    const resolutionSourceKey = normalizeText(resolution.source_key);
    if (!resolutionSource || !resolutionSourceKey) continue;
    brandResolutionByKey.set(`${resolutionSource}|${resolutionSourceKey}`, resolution);
  }

  await deps.repository.deleteReportRowsByBatch(batchId);
  await deps.repository.updateImportBatch(batchId, {
    inserted_count: 0,
    skipped_count: 0,
    error_count: 0,
    status: "running",
    completed_at: null,
  });

  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let inRangeRowCount = 0;
  let filteredOutOfRangeCount = 0;
  let filteredInvalidDateCount = 0;
  const rowResults: Array<Record<string, unknown>> = [];

  for (let rowIndex = 0; rowIndex < rowsRaw.length; rowIndex++) {
    const storedRow = rowsRaw[rowIndex];
    const raw = storedRow.raw;
    try {
      if (
        storedRow.message === "Outside selected import range" ||
        storedRow.message === "Invalid posted_at for selected import range"
      ) {
        const status = storedRow.message === "Outside selected import range" ? "skipped" : "error";
        if (status === "skipped") {
          skippedCount += 1;
          filteredOutOfRangeCount += 1;
        } else {
          errorCount += 1;
          filteredInvalidDateCount += 1;
        }

        await deps.repository.insertReportRow({
          batch_id: batchId,
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: rowIndex,
          source_line_index: null,
          status,
          message: storedRow.message,
          transaction_id: null,
          line_item_id: null,
          payload: raw as unknown as Record<string, unknown>,
        });

        rowResults.push({
          idx: rowIndex,
          status,
          message: storedRow.message,
          transaction_id: null,
        });
        continue;
      }

      const rawRangeDecision = classifyRowForWindow(raw.posted_at, windowFromInput, windowToInput);
      if (rawRangeDecision.kind === "invalid_date") {
        errorCount += 1;
        filteredInvalidDateCount += 1;
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
          payload: raw as unknown as Record<string, unknown>,
        });
        rowResults.push({
          idx: rowIndex,
          status: "error",
          message: rawRangeDecision.message,
          transaction_id: null,
        });
        continue;
      }

      const normalizedBase = normalizeTransactionRow(raw, transactionSourceFallback);
      const rangeDecision = classifyRowForWindow(
        normalizedBase.posted_at,
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
          payload: normalizedBase,
        });
        rowResults.push({
          idx: rowIndex,
          status: "skipped",
          message: rangeDecision.message,
          transaction_id: null,
        });
        continue;
      }
      inRangeRowCount += 1;
      let accountId = normalizeText(normalizedBase.account_id);
      if (!accountId) {
        accountId = await deps.repository.resolveAccountIdForRow(
          payerPersonId,
          normalizedBase,
          transactionSourceFallback,
        );
      }

      const resolvedCardId = await deps.repository.resolveCardIdForRow(
        accountId,
        { ...normalizedBase, account_id: accountId },
        true,
      );
      const brandResolution = (() => {
        const key = brandCacheKeyForRow(normalizedBase, transactionSourceFallback);
        return key ? (brandResolutionByKey.get(key) ?? null) : null;
      })();
      const resolvedBrandId = deps.repository.resolveBrandIdForRow
        ? await deps.repository.resolveBrandIdForRow(
            normalizedBase,
            transactionSourceFallback,
            true,
            brandResolution
              ? {
                  selected_action:
                    normalizeText(brandResolution.selected_action) === "match_existing"
                      ? "match_existing"
                      : "create_new",
                  selected_brand_id: normalizeText(brandResolution.selected_brand_id),
                }
              : null,
          )
        : null;
      const normalized: CanonicalTransactionRowInput = {
        ...normalizedBase,
        account_id: accountId,
        card_id: resolvedCardId,
        brand_id: resolvedBrandId,
      };
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
        payload: raw as unknown as Record<string, unknown>,
      });

      rowResults.push({
        idx: rowIndex,
        status: "error",
        message,
        transaction_id: null,
      });
    }
  }

  const patch: Record<string, unknown> = {
    parsed_transactions_count: rowsRaw.length,
    inserted_count: insertedCount,
    skipped_count: skippedCount,
    error_count: errorCount,
    status: "completed",
    completed_at: (deps.now ?? (() => new Date()))().toISOString(),
    meta: mergeRangeMeta(batch.meta, null, {
      parsedRowCount: 0,
      inRangeRowCount,
      filteredOutOfRangeCount,
      filteredInvalidDateCount,
    }),
  };
  const parsedThrough =
    normalizeText(batch.parsed_through_at) ??
    (rowsRaw.length > 0
      ? (rowsRaw
          .map((row) => toIsoOrNull(row.raw.posted_at))
          .filter((value): value is string => Boolean(value))
          .sort()[0] ?? null)
      : null);
  if (parsedThrough) patch.parsed_through_at = parsedThrough;
  if (toIsoOrNull(batch.window_from)) patch.window_from = toIsoOrNull(batch.window_from);
  if (toIsoOrNull(batch.window_to)) patch.window_to = toIsoOrNull(batch.window_to);

  await deps.repository.updateImportBatch(batchId, patch);
  deps.telemetry?.info("money_import_apply_batch_completed", {
    batch_id: batchId,
    row_count: rowsRaw.length,
    inserted: insertedCount,
    skipped: skippedCount,
    error_count: errorCount,
  });
  await actionSpan?.end({
    status: "ok",
    attrs: {
      batch_id: batchId,
      row_count: rowsRaw.length,
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
