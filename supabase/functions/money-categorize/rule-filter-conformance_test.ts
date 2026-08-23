import { assertEquals } from "std/assert/assert-equals";
import { __test__ } from "./service.ts";
import type { MoneyCategoryRuleContext, MoneyCategoryRuleFilter } from "./service.ts";

/**
 * The rule engine exists twice: here in TypeScript, and in PL/pgSQL as
 * money_evaluate_category_rule_filter. Which one runs depends on whether the person has an
 * LLM rule enabled — so turning one rule on must not quietly change how every other rule
 * behaves. This suite and its pgTAP twin run the same corpus through both.
 */

interface ConformanceCase {
  name: string;
  context: {
    line_item: { title: string | null; amount: number | null };
    transaction: Record<string, unknown>;
    account: { source: string | null; account_kind: string | null };
  };
  current_category_id: string | null;
  current_canonical_system_key: string | null;
  filter: MoneyCategoryRuleFilter;
  expected: boolean;
}

const cases = JSON.parse(
  await Deno.readTextFile(
    new URL("../../tests/fixtures/money_rule_filter_cases.json", import.meta.url),
  ),
) as ConformanceCase[];

function buildContext(entry: ConformanceCase): MoneyCategoryRuleContext {
  const transaction = entry.context.transaction;
  return {
    line_item: {
      id: "line-1",
      transaction_id: "tx-1",
      title: entry.context.line_item.title,
      amount: entry.context.line_item.amount,
      quantity: null,
      unit: null,
      line_status: "final",
      category_id: null,
      assignment_method: null,
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
      payer_person_id: (transaction.payer_person_id as string) ?? "person-1",
      account_id: "acc-1",
      source: (transaction.source as string | null) ?? null,
      posted_at: "2026-02-01T10:00:00.000Z",
      amount: (transaction.amount as number | null) ?? null,
      currency: "RUB",
      transaction_type: (transaction.transaction_type as string | null) ?? null,
      status: "posted",
      merchant_name: (transaction.merchant_name as string | null) ?? null,
      mcc: (transaction.mcc as string | null) ?? null,
      comment: (transaction.comment as string | null) ?? null,
      source_comment: (transaction.source_comment as string | null) ?? null,
      source_category_id: (transaction.source_category_id as string | null) ?? null,
      source_category_name: (transaction.source_category_name as string | null) ?? null,
      is_transfer: (transaction.is_transfer as boolean | null) ?? null,
    },
    account: {
      id: "acc-1",
      source: entry.context.account.source,
      account_kind: entry.context.account.account_kind,
    },
    current_category: {
      id: entry.current_category_id,
      kind: null,
      canonical_category_id: null,
      canonical_system_key: entry.current_canonical_system_key,
    },
  } as unknown as MoneyCategoryRuleContext;
}

Deno.test("rule filter conformance corpus covers every operator", () => {
  const operators = new Set(cases.map((entry) => entry.filter.operator));
  for (const operator of [
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
  ]) {
    assertEquals(operators.has(operator as MoneyCategoryRuleFilter["operator"]), true, operator);
  }
  // Fewer than forty cases is not a corpus, it is a handful of examples.
  assertEquals(cases.length >= 40, true, `expected at least 40 cases, got ${cases.length}`);
});

for (const entry of cases) {
  Deno.test(`rule filter: ${entry.name}`, () => {
    const context = buildContext(entry);
    const state = {
      currentCategoryId: entry.current_category_id,
      currentCategoryKind: null,
      currentCanonicalCategoryId: null,
      currentCanonicalSystemKey: entry.current_canonical_system_key,
    };

    assertEquals(
      __test__.evaluateRuleFilter(
        context,
        state as unknown as Parameters<typeof __test__.evaluateRuleFilter>[1],
        entry.filter,
      ),
      entry.expected,
    );
  });
}
