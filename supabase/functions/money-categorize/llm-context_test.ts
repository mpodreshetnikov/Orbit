import { assertEquals } from "std/assert/assert-equals";
import {
  buildLlmCategorizeItemContext,
  LLM_RAW_PAYLOAD_MAX_BYTES,
  truncateJsonForLlm,
} from "./llm-context.ts";
import type { MoneyCategorizeLlmBatchRequestItem, MoneyCategoryRuleContext } from "./service.ts";

function createContext(overrides?: {
  siblings?: MoneyCategoryRuleContext["receipt_sibling_items"];
  rawPayload?: Record<string, unknown>;
}): MoneyCategoryRuleContext {
  return {
    line_item: {
      id: "line-target",
      transaction_id: "tx-1",
      title: "Milk",
      amount: -89,
      quantity: 1,
      unit: "pcs",
      line_status: "final",
      category_id: "cat-food",
      assignment_method: "import",
      assignment_rule_id: null,
      assignment_confidence: null,
      raw_payload: { sku: "milk-1" },
      category_locked_by_user: false,
      last_category_rule_id: null,
      last_category_rule_run_id: null,
      category_assigned_at: null,
    },
    transaction: {
      id: "tx-1",
      payer_person_id: "person-1",
      account_id: "account-1",
      card_id: "card-1",
      source: "tbank",
      posted_at: "2026-03-10T10:00:00.000Z",
      amount: -500,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: "Samokat",
      mcc: "3991",
      comment: null,
      source_comment: null,
      source_category_id: "grocery",
      source_category_name: "Grocery",
      cashback_amount: null,
      brand_id: "brand-1",
      is_transfer: false,
      raw_payload: overrides?.rawPayload ?? { operation: { id: "op-1" } },
    },
    account: {
      id: "account-1",
      source: "tbank",
      account_kind: "debit",
      account_label: "Main debit",
    },
    card: {
      id: "card-1",
      last4: "4242",
      card_label: "Black",
    },
    brand: {
      id: "brand-1",
      name: "Samokat",
      slug: "samokat",
    },
    current_category: {
      id: "cat-food",
      kind: "canonical",
      name_en: "Food",
      name_ru: "Еда",
      system_key: "food",
      canonical_category_id: "cat-food",
      canonical_system_key: "food",
    },
    receipt_sibling_items: overrides?.siblings ?? [
      {
        id: "line-sib-1",
        title: "Bread",
        amount: -60,
        quantity: 1,
        unit: "pcs",
        line_status: "final",
        category_id: null,
        assignment_method: "import",
      },
      {
        id: "line-sib-2",
        title: "Eggs",
        amount: -120,
        quantity: 10,
        unit: "pcs",
        line_status: "final",
        category_id: "cat-food",
        assignment_method: "rule",
      },
    ],
    derived: {
      normalized_line_item_title: "milk",
      normalized_merchant_name: "samokat",
      absolute_line_item_amount: 89,
      unit_price: 89,
      posted_day_of_week: 2,
      posted_month: 3,
      current_category_kind: "canonical",
      current_canonical_system_key: "food",
      has_receipt_metadata: true,
    },
  };
}

function createItem(
  context: MoneyCategoryRuleContext = createContext(),
): MoneyCategorizeLlmBatchRequestItem {
  return {
    lineItemId: "line-target",
    currentCategoryId: "cat-food",
    currentCanonicalSystemKey: "food",
    context,
  };
}

Deno.test("buildLlmCategorizeItemContext separates target_line_item from siblings", () => {
  const payload = buildLlmCategorizeItemContext(createItem());

  assertEquals((payload.target_line_item as { id: string }).id, "line-target");
  assertEquals((payload.target_line_item as { title: string }).title, "Milk");
  assertEquals(
    (payload.receipt_sibling_items as Array<{ id: string }>).map((item) => item.id),
    ["line-sib-1", "line-sib-2"],
  );
  assertEquals((payload.card as { last4: string }).last4, "4242");
  assertEquals((payload.account as { account_label: string }).account_label, "Main debit");
  assertEquals((payload.brand as { name: string }).name, "Samokat");
  assertEquals((payload.transaction as { card_id: string }).card_id, "card-1");
  assertEquals((payload.current_category as { name_ru: string }).name_ru, "Еда");
});

Deno.test("buildLlmCategorizeItemContext keeps empty siblings for single-line receipts", () => {
  const payload = buildLlmCategorizeItemContext(createItem(createContext({ siblings: [] })));

  assertEquals(payload.receipt_sibling_items, []);
  assertEquals((payload.target_line_item as { id: string }).id, "line-target");
});

Deno.test("truncateJsonForLlm keeps small payloads intact", () => {
  const value = { a: 1, b: "ok" };
  assertEquals(truncateJsonForLlm(value), value);
});

Deno.test("truncateJsonForLlm marks oversized payloads", () => {
  const huge = { blob: "x".repeat(LLM_RAW_PAYLOAD_MAX_BYTES + 200), keep: "yes" };
  const truncated = truncateJsonForLlm(huge) as Record<string, unknown>;
  assertEquals(truncated._truncated, true);
  assertEquals(typeof truncated._original_bytes, "number");
  assertEquals(
    new TextEncoder().encode(JSON.stringify(truncated)).length <= LLM_RAW_PAYLOAD_MAX_BYTES,
    true,
  );
});

Deno.test("buildLlmCategorizeItemContext applies safe-sized transaction.raw_payload", () => {
  const payload = buildLlmCategorizeItemContext(
    createItem(
      createContext({
        rawPayload: { blob: "y".repeat(LLM_RAW_PAYLOAD_MAX_BYTES + 100) },
      }),
    ),
  );
  const raw = (payload.transaction as { raw_payload: Record<string, unknown> }).raw_payload;
  assertEquals(raw._truncated, true);
});

Deno.test(
  "buildLlmCategorizeItemContext prefers pipeline currentCategoryId over snapshot ids",
  () => {
    const context = createContext();
    context.line_item.category_id = "cat-old";
    context.current_category.id = "cat-old";
    const payload = buildLlmCategorizeItemContext({
      lineItemId: "line-target",
      currentCategoryId: "cat-food",
      currentCanonicalSystemKey: "food",
      context,
    });

    assertEquals(payload.current_category_id, "cat-food");
    assertEquals((payload.target_line_item as { category_id: string }).category_id, "cat-food");
    assertEquals((payload.current_category as { id: string }).id, "cat-food");
  },
);
