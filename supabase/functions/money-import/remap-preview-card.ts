import { extractAccountHintFromRow, jsonResponse, normalizeText } from "./normalize.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, CanonicalTransactionRowInput } from "./types.ts";

export interface RemapPreviewCardDeps {
  repository: MoneyImportRepository;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export async function remapPreviewCardAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: RemapPreviewCardDeps,
): Promise<Response> {
  const batchId = normalizeText(body.batch_id);
  const cardId = normalizeText(body.card_id);
  const targetAccountId = normalizeText(body.target_account_id);

  if (!batchId) return jsonResponse({ error: "batch_id is required" }, 400);
  if (!cardId) return jsonResponse({ error: "card_id is required" }, 400);
  if (!targetAccountId) return jsonResponse({ error: "target_account_id is required" }, 400);
  if (auth.mode !== "user") return jsonResponse({ error: "Unauthorized" }, 401);

  const batch = await deps.repository.getImportBatchForUser(batchId, auth.userId);
  if (!batch) return jsonResponse({ error: "Batch not found" }, 404);
  if (normalizeText(batch.status) !== "pending") {
    return jsonResponse({ error: "Batch is not awaiting review" }, 409);
  }

  const rows = await deps.repository.listReportRowsByBatch(batchId);
  const matchingRows = rows.filter((row) => {
    if (normalizeText(row.row_kind) !== "transaction") return false;
    const payload = asRecord(row.payload);
    return normalizeText(payload.card_id) === cardId;
  });
  if (matchingRows.length === 0) {
    return jsonResponse({ error: "Preview card mapping not found in batch" }, 404);
  }

  const samplePayload = asRecord(
    matchingRows[0]?.payload,
  ) as unknown as CanonicalTransactionRowInput;
  const accountHint = extractAccountHintFromRow(samplePayload);
  if (!accountHint) {
    return jsonResponse({ error: "Preview card hint is missing" }, 400);
  }

  const resultingCardId = await deps.repository.resolveCardIdForRow(
    targetAccountId,
    {
      posted_at: samplePayload.posted_at,
      amount: samplePayload.amount,
      transaction_type: samplePayload.transaction_type,
      account_hint: accountHint,
      raw_payload: {
        ...asRecord(samplePayload.raw_payload),
        account_hint: accountHint,
      },
    },
    true,
  );

  if (!resultingCardId) {
    return jsonResponse({ error: "Could not resolve target preview card" }, 400);
  }

  await deps.repository.deleteReportRowsByBatch(batchId);

  const transactionRowIds = new Map<string, string>();
  let updatedRowCount = 0;

  for (const row of rows.filter((item) => normalizeText(item.row_kind) === "transaction")) {
    const payload = asRecord(row.payload);
    const shouldRewrite = normalizeText(payload.card_id) === cardId;
    const nextPayload = shouldRewrite
      ? {
          ...payload,
          account_id: targetAccountId,
          account_hint: accountHint,
          card_id: resultingCardId,
          raw_payload: {
            ...asRecord(payload.raw_payload),
            account_hint: accountHint,
          },
        }
      : payload;

    if (shouldRewrite) updatedRowCount += 1;

    const insertedRowId = await deps.repository.insertReportRow({
      batch_id: row.batch_id,
      parent_row_id: null,
      row_kind: row.row_kind,
      source_row_index: row.source_row_index,
      source_line_index: row.source_line_index,
      status: row.status,
      message: row.message,
      transaction_id: row.transaction_id,
      line_item_id: row.line_item_id,
      payload: nextPayload,
    });

    transactionRowIds.set(normalizeText(row.id) ?? insertedRowId, insertedRowId);
  }

  for (const row of rows.filter((item) => normalizeText(item.row_kind) === "line_item")) {
    const parentRowId = normalizeText(row.parent_row_id);
    await deps.repository.insertReportRow({
      batch_id: row.batch_id,
      parent_row_id: parentRowId ? (transactionRowIds.get(parentRowId) ?? null) : null,
      row_kind: row.row_kind,
      source_row_index: row.source_row_index,
      source_line_index: row.source_line_index,
      status: row.status,
      message: row.message,
      transaction_id: row.transaction_id,
      line_item_id: row.line_item_id,
      payload: row.payload,
    });
  }

  return jsonResponse({
    batch_id: batchId,
    previous_card_id: cardId,
    resulting_card_id: resultingCardId,
    target_account_id: targetAccountId,
    updated_row_count: updatedRowCount,
  });
}
