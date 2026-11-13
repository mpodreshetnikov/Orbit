/**
 * Covers every MoneyRuleFilterOperator and JS↔SQL regex parity notes (T-261113-qgz).
 * SQL twin: supabase/tests/functions/money_evaluate_category_rule_filter_test.sql
 */
import { assertEquals } from "std/assert/assert-equals";
import {
  evaluateRuleFilter,
  type MoneyCategoryRuleContext,
  type MoneyCategoryRuleFilter,
  type MoneyRuleFilterOperator,
} from "./service.ts";

const emptyState = {
  currentCategoryId: null as string | null,
  currentCategoryKind: null as "canonical" | "custom" | null,
  currentCanonicalCategoryId: null as string | null,
  currentCanonicalSystemKey: null as string | null,
};

function context(overrides?: {
  title?: string;
  merchant?: string | null;
  amount?: number;
  txAmount?: number;
  isTransfer?: boolean;
  comment?: string | null;
}): MoneyCategoryRuleContext {
  return {
    line_item: {
      id: "line-1",
      transaction_id: "tx-1",
      title: overrides?.title ?? "Flat White Latte",
      amount: overrides?.amount ?? 450,
      quantity: 1,
      unit: "pcs",
      line_status: "final",
      category_id: null,
      assignment_method: "import",
      assignment_rule_id: null,
      assignment_confidence: null,
      raw_payload: {},
      category_locked_by_user: false,
      last_category_rule_id: null,
      last_category_rule_run_id: null,
      category_assigned_at: null,
    },
    transaction: {
      id: "tx-1",
      payer_person_id: "person-1",
      account_id: "acc-1",
      source: "tbank",
      posted_at: "2026-03-01T10:00:00.000Z",
      amount: overrides?.txAmount ?? 450,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: overrides?.merchant ?? "Coffee House",
      mcc: "5814",
      comment: overrides?.comment ?? null,
      source_comment: null,
      source_category_id: null,
      source_category_name: null,
      cashback_amount: null,
      brand_id: null,
      is_transfer: overrides?.isTransfer ?? false,
      raw_payload: {},
    },
    account: {
      source: "tbank",
      account_kind: "debit",
    },
    current_category: {
      id: null,
      kind: null,
      canonical_category_id: null,
      canonical_system_key: null,
    },
    derived: {
      normalized_line_item_title: (overrides?.title ?? "Flat White Latte").toLowerCase(),
      normalized_merchant_name: (overrides?.merchant ?? "Coffee House").toLowerCase(),
      absolute_line_item_amount: overrides?.amount ?? 450,
      unit_price: overrides?.amount ?? 450,
      posted_day_of_week: 2,
      posted_month: 3,
      current_category_kind: null,
      current_canonical_system_key: null,
      has_receipt_metadata: true,
    },
  };
}

function check(
  filter: MoneyCategoryRuleFilter,
  expected: boolean,
  ctx: MoneyCategoryRuleContext = context(),
) {
  assertEquals(evaluateRuleFilter(ctx, emptyState, filter), expected, JSON.stringify(filter));
}

Deno.test("evaluateRuleFilter covers every operator", () => {
  const operators: MoneyRuleFilterOperator[] = [
    "contains",
    "not_contains",
    "equals",
    "starts_with",
    "regex",
    "contains_any_in_set",
    "equals_any_in_set",
    "in_set",
    "range",
    "is_empty",
    "is_not_empty",
  ];
  // Smoke each operator path once so a missing case is a mutation kill.
  check({ field: "merchant_name", operator: "contains", value: "coffee" }, true);
  check({ field: "merchant_name", operator: "contains", value: "tea" }, false);
  check({ field: "merchant_name", operator: "not_contains", value: "tea" }, true);
  check({ field: "merchant_name", operator: "not_contains", value: "coffee" }, false);
  check({ field: "merchant_name", operator: "equals", value: "Coffee House" }, true);
  check({ field: "merchant_name", operator: "equals", value: "Other" }, false);
  check({ field: "merchant_name", operator: "starts_with", value: "coffee" }, true);
  check({ field: "merchant_name", operator: "starts_with", value: "house" }, false);
  check({ field: "line_item_title", operator: "regex", value: "Flat\\s+White" }, true);
  check({ field: "line_item_title", operator: "regex", value: "^Latte" }, false);
  check(
    { field: "merchant_name", operator: "contains_any_in_set", values: ["tea", "coffee"] },
    true,
  );
  check(
    { field: "merchant_name", operator: "equals_any_in_set", values: ["coffee house", "market"] },
    true,
  );
  check({ field: "merchant_name", operator: "in_set", values: ["coffee house"] }, true);
  check({ field: "line_item_amount", operator: "range", min: 400, max: 500 }, true);
  check({ field: "line_item_amount", operator: "range", min: 500, max: 600 }, false);
  check({ field: "transaction_comment", operator: "is_empty" }, true, context({ comment: null }));
  check(
    { field: "transaction_comment", operator: "is_not_empty" },
    true,
    context({ comment: "note" }),
  );

  // Amount / boolean equals + set variants.
  check({ field: "line_item_amount", operator: "equals", value: 450 }, true);
  check(
    { field: "is_transfer", operator: "equals", value: false },
    true,
    context({ isTransfer: false }),
  );
  check(
    { field: "is_transfer", operator: "in_set", values: ["true"] },
    true,
    context({ isTransfer: true }),
  );

  // Every operator name is exercised (guards against dropping a case label).
  for (const operator of operators) {
    const filter: MoneyCategoryRuleFilter =
      operator === "range"
        ? { field: "line_item_amount", operator, min: 0, max: 9999 }
        : operator === "contains_any_in_set" ||
            operator === "equals_any_in_set" ||
            operator === "in_set"
          ? { field: "merchant_name", operator, values: ["coffee house"] }
          : operator === "is_empty" || operator === "is_not_empty"
            ? { field: "transaction_comment", operator }
            : { field: "merchant_name", operator, value: "coffee" };
    // Must not throw; result is boolean either way.
    const result = evaluateRuleFilter(context(), emptyState, filter);
    assertEquals(typeof result, "boolean", operator);
  }
});

Deno.test("evaluateRuleFilter regex matches SQL parity cases (raw, case-sensitive)", () => {
  // Both JS RegExp and Postgres ~ use the raw field value (not lowercased text).
  // Case-insensitive syntax differs by engine (JS flags vs POSIX); shared contract is
  // case-sensitive match on raw + invalid pattern → false.
  check({ field: "line_item_title", operator: "regex", value: "Flat" }, true);
  check({ field: "line_item_title", operator: "regex", value: "flat" }, false);
  check({ field: "line_item_title", operator: "regex", value: "[" }, false);
});

Deno.test("evaluateRuleFilter unknown operator is false", () => {
  check(
    {
      field: "merchant_name",
      operator: "nope" as MoneyRuleFilterOperator,
      value: "coffee",
    },
    false,
  );
});
