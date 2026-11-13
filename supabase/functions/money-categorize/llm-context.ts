import type { MoneyCategorizeLlmBatchRequestItem, MoneyCategoryRuleContext } from "./service.ts";

/** Cap transaction/line raw_payload size sent to LLM providers (bytes of JSON text). */
export const LLM_RAW_PAYLOAD_MAX_BYTES = 4096;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") {
        return Object.keys(asRecord(value)).length > 0;
      }
      return true;
    }),
  );
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Keep LLM payloads bounded: return the value when small enough, otherwise a
 * truncated marker with shallow keys that individually fit under the budget.
 */
export function truncateJsonForLlm(
  value: unknown,
  maxBytes: number = LLM_RAW_PAYLOAD_MAX_BYTES,
): unknown {
  if (value == null) return {};
  const encoded = JSON.stringify(value);
  if (utf8ByteLength(encoded) <= maxBytes) {
    return value;
  }

  const record = asRecord(value);
  const shallow: Record<string, unknown> = {
    _truncated: true,
    _original_bytes: utf8ByteLength(encoded),
  };

  for (const [key, entry] of Object.entries(record)) {
    const candidate = { ...shallow, [key]: entry };
    if (utf8ByteLength(JSON.stringify(candidate)) > maxBytes) continue;
    shallow[key] = entry;
  }

  return shallow;
}

function buildTargetLineItem(ctx: MoneyCategoryRuleContext): Record<string, unknown> {
  return compactRecord({
    id: ctx.line_item.id,
    title: ctx.line_item.title,
    amount: ctx.line_item.amount,
    quantity: ctx.line_item.quantity,
    unit: ctx.line_item.unit,
    line_status: ctx.line_item.line_status,
    category_id: ctx.line_item.category_id,
    assignment_method: ctx.line_item.assignment_method,
    raw_payload: truncateJsonForLlm(ctx.line_item.raw_payload),
  });
}

function buildSiblingItems(ctx: MoneyCategoryRuleContext): Record<string, unknown>[] {
  return (ctx.receipt_sibling_items ?? []).map((sibling) =>
    compactRecord({
      id: sibling.id,
      title: sibling.title,
      amount: sibling.amount,
      quantity: sibling.quantity,
      unit: sibling.unit,
      line_status: sibling.line_status,
      category_id: sibling.category_id,
      assignment_method: sibling.assignment_method,
    }),
  );
}

/**
 * Explicit target vs sibling structure shared by Jev state and OpenRouter prompts
 * so the model classifies only `target_line_item`.
 */
export function buildLlmCategorizeItemContext(
  item: MoneyCategorizeLlmBatchRequestItem,
): Record<string, unknown> {
  const ctx = item.context;

  // Always include receipt_sibling_items (even []) so single- and multi-line
  // receipts share the same explicit target-vs-sibling contract.
  return {
    ...compactRecord({
      line_item_id: item.lineItemId,
      current_category_id: item.currentCategoryId,
      current_canonical_system_key: item.currentCanonicalSystemKey,
      target_line_item: buildTargetLineItem(ctx),
      transaction: compactRecord({
        id: ctx.transaction.id,
        payer_person_id: ctx.transaction.payer_person_id,
        account_id: ctx.transaction.account_id,
        card_id: ctx.transaction.card_id,
        source: ctx.transaction.source,
        posted_at: ctx.transaction.posted_at,
        amount: ctx.transaction.amount,
        currency: ctx.transaction.currency,
        transaction_type: ctx.transaction.transaction_type,
        status: ctx.transaction.status,
        merchant_name: ctx.transaction.merchant_name,
        mcc: ctx.transaction.mcc,
        comment: ctx.transaction.comment,
        source_comment: ctx.transaction.source_comment,
        source_category_id: ctx.transaction.source_category_id,
        source_category_name: ctx.transaction.source_category_name,
        cashback_amount: ctx.transaction.cashback_amount,
        brand_id: ctx.transaction.brand_id,
        is_transfer: ctx.transaction.is_transfer,
        raw_payload: truncateJsonForLlm(ctx.transaction.raw_payload),
      }),
      card: compactRecord({
        id: ctx.card?.id ?? null,
        last4: ctx.card?.last4 ?? null,
        card_label: ctx.card?.card_label ?? null,
      }),
      account: compactRecord({
        id: ctx.account.id,
        source: ctx.account.source,
        account_kind: ctx.account.account_kind,
        account_label: ctx.account.account_label,
      }),
      brand: compactRecord({
        id: ctx.brand?.id ?? null,
        name: ctx.brand?.name ?? null,
        slug: ctx.brand?.slug ?? null,
      }),
      current_category: compactRecord({
        id: ctx.current_category.id,
        kind: ctx.current_category.kind,
        name_en: ctx.current_category.name_en,
        name_ru: ctx.current_category.name_ru,
        system_key: ctx.current_category.system_key,
        canonical_category_id: ctx.current_category.canonical_category_id,
        canonical_system_key: ctx.current_category.canonical_system_key,
      }),
      derived: compactRecord({
        normalized_line_item_title: ctx.derived.normalized_line_item_title,
        normalized_merchant_name: ctx.derived.normalized_merchant_name,
        absolute_line_item_amount: ctx.derived.absolute_line_item_amount,
        unit_price: ctx.derived.unit_price,
        posted_day_of_week: ctx.derived.posted_day_of_week,
        posted_month: ctx.derived.posted_month,
        current_category_kind: ctx.derived.current_category_kind,
        current_canonical_system_key: ctx.derived.current_canonical_system_key,
        has_receipt_metadata: ctx.derived.has_receipt_metadata,
      }),
    }),
    receipt_sibling_items: buildSiblingItems(ctx),
  };
}
