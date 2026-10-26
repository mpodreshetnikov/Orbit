import type { BatchTransactionRow, CanonicalTransactionRow } from "./import";

/**
 * A statement's rows on their way to `money-import`: the card each one names, and the batch rows
 * once every card has an account. The web import page and the phone share these.
 */

function normalizeMaskedCardHint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function normalizeOperationText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function collectOperationHintCandidates(operation: Record<string, unknown> | null): string[] {
  if (!operation) return [];
  return Array.from(
    new Set(
      [
        normalizeMaskedCardHint(operation.cardNumber),
        normalizeMaskedCardHint(
          operation.payment && typeof operation.payment === "object"
            ? (operation.payment as Record<string, unknown>).cardNumber
            : null,
        ),
        normalizeMaskedCardHint(
          operation.card && typeof operation.card === "object"
            ? (operation.card as Record<string, unknown>).panMasked
            : null,
        ),
        normalizeMaskedCardHint(
          operation.card && typeof operation.card === "object"
            ? (operation.card as Record<string, unknown>).number
            : null,
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function isAccountNativeOperation(
  row: CanonicalTransactionRow,
  operation: Record<string, unknown> | null,
): boolean {
  if (row.is_transfer) return true;
  if (!operation) return false;

  const texts = [
    normalizeOperationText(row.merchant_name),
    normalizeOperationText(
      typeof operation.description === "string" ? operation.description : null,
    ),
    normalizeOperationText(
      typeof operation.merchantKey === "string" ? operation.merchantKey : null,
    ),
    normalizeOperationText(
      typeof operation.subcategory === "string" ? operation.subcategory : null,
    ),
    normalizeOperationText(typeof operation.group === "string" ? operation.group : null),
    normalizeOperationText(
      operation.subgroup && typeof operation.subgroup === "object"
        ? (operation.subgroup as Record<string, unknown>).name
        : null,
    ),
    normalizeOperationText(
      operation.spendingCategory && typeof operation.spendingCategory === "object"
        ? (operation.spendingCategory as Record<string, unknown>).name
        : null,
    ),
    normalizeOperationText(
      operation.categoryInfo &&
        typeof operation.categoryInfo === "object" &&
        (operation.categoryInfo as Record<string, unknown>).bankCategory &&
        typeof (operation.categoryInfo as Record<string, unknown>).bankCategory === "object"
        ? ((
            (operation.categoryInfo as Record<string, unknown>).bankCategory as Record<
              string,
              unknown
            >
          ).name as unknown)
        : null,
    ),
    normalizeOperationText(
      operation.categoryInfo &&
        typeof operation.categoryInfo === "object" &&
        (operation.categoryInfo as Record<string, unknown>).metacategory &&
        typeof (operation.categoryInfo as Record<string, unknown>).metacategory === "object"
        ? ((
            (operation.categoryInfo as Record<string, unknown>).metacategory as Record<
              string,
              unknown
            >
          ).name as unknown)
        : null,
    ),
    normalizeOperationText(
      operation.category && typeof operation.category === "object"
        ? (operation.category as Record<string, unknown>).name
        : null,
    ),
    normalizeOperationText(
      operation.payment && typeof operation.payment === "object"
        ? (operation.payment as Record<string, unknown>).providerId
        : null,
    ),
    normalizeOperationText(
      operation.payment && typeof operation.payment === "object"
        ? (operation.payment as Record<string, unknown>).providerGroupId
        : null,
    ),
    normalizeOperationText(
      operation.payment && typeof operation.payment === "object"
        ? (operation.payment as Record<string, unknown>).paymentType
        : null,
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (
    /between own accounts|between my accounts|card to card|p2p|transfer-inner|внутрибанковский перевод|между своими счетами|пополнение по номеру телефона|перевод|переводы/.test(
      texts,
    )
  ) {
    return true;
  }

  return /interest|balance interest|deposit|bonus|correction|cashback payout|проценты|вклад|бонус|коррекц|пополнение вклада|закрытие вклада/.test(
    texts,
  );
}

export function getAccountHint(row: CanonicalTransactionRow): string | null {
  const rawPayload =
    row.raw_payload && typeof row.raw_payload === "object"
      ? (row.raw_payload as Record<string, unknown>)
      : null;
  const rawOperation =
    rawPayload?.operation && typeof rawPayload.operation === "object"
      ? (rawPayload.operation as Record<string, unknown>)
      : null;

  if (isAccountNativeOperation(row, rawOperation)) return null;

  const directHint = normalizeMaskedCardHint(row.account_hint);
  const rawHint = normalizeMaskedCardHint(rawPayload?.account_hint);
  const operationCandidates = collectOperationHintCandidates(rawOperation);

  const uniqueHints = Array.from(
    new Set(
      [directHint, rawHint, ...operationCandidates].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  );

  if (rawOperation && uniqueHints.length > 1) return null;
  if (directHint) return directHint;
  if (rawHint) return rawHint;
  if (operationCandidates.length === 1) return operationCandidates[0];
  return null;
}

/** The cards a statement names, each once, in order. */
export function importAccountHints(rows: CanonicalTransactionRow[]): string[] {
  return Array.from(
    new Set(rows.map((row) => getAccountHint(row)).filter((hint): hint is string => !!hint)),
  ).sort();
}

/**
 * The rows as `preview_rows` takes them. No row names an account: the server finds it by the card,
 * or puts it on the bank's first account (T-261026-2ew), so nobody is asked before an import.
 */
export function importBatchRows(rows: CanonicalTransactionRow[]): BatchTransactionRow[] {
  const batch: BatchTransactionRow[] = [];
  for (const row of rows) {
    const accountHint = getAccountHint(row);
    batch.push({
      account_hint: accountHint,
      card_id: row.card_id ?? null,
      source: row.source,
      external_id: row.external_id ?? null,
      posted_at: row.posted_at,
      amount: row.amount,
      currency: row.currency,
      transaction_type: row.transaction_type,
      status: row.status,
      merchant_name: row.merchant_name ?? null,
      mcc: row.mcc ?? null,
      comment: row.comment ?? null,
      source_comment: row.source_comment ?? null,
      cashback_amount: row.cashback_amount ?? null,
      cashback_currency: row.cashback_currency ?? null,
      operation_icon_url: row.operation_icon_url ?? null,
      source_category: row.source_category ?? null,
      source_brand: row.source_brand ?? null,
      is_transfer: row.is_transfer,
      transfer_group_id: row.transfer_group_id ?? null,
      raw_payload: { ...(row.raw_payload ?? {}), account_hint: accountHint },
      dedupe_hash: row.dedupe_hash ?? null,
      line_items: row.line_items,
    });
  }
  return batch;
}
