// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { callJevMoneyCategorizeBatch, DEFAULT_JEV_MODEL } from "./jev-categorize.ts";
import type { MoneyCategorizeLlmBatchRequest } from "./service.ts";

function createBatchRequest(lineItemIds: string[]): MoneyCategorizeLlmBatchRequest {
  return {
    rule: {
      id: "rule-llm",
      person_id: "person-1",
      name: "LLM category",
      description: null,
      enabled: true,
      sort_order: 1,
      rule_kind: "llm_categorization",
      target_category_id: null,
      match_mode: "all",
      scope_filter: "all_line_items",
      filters: [],
      config: { prompt: "Prefer food for cafes.", provider: "jev" },
      stop_processing: false,
      created_at: null,
    },
    candidateCategories: [
      {
        id: "cat-food",
        name_en: "Food",
        name_ru: "Еда",
        slug: "food",
        category_kind: "canonical",
        canonical_category_id: "cat-food",
        canonical_system_key: "food",
      },
      {
        id: "cat-transport",
        name_en: "Transport",
        name_ru: "Транспорт",
        slug: "transport",
        category_kind: "canonical",
        canonical_category_id: "cat-transport",
        canonical_system_key: "transport",
      },
      {
        id: "cat-uncategorized",
        name_en: "Uncategorized",
        name_ru: "Без категории",
        slug: "uncategorized",
        category_kind: "canonical",
        canonical_category_id: "cat-uncategorized",
        canonical_system_key: "uncategorized",
      },
    ],
    items: lineItemIds.map((lineItemId, index) => ({
      lineItemId,
      currentCategoryId: index === 0 ? "cat-transport" : null,
      currentCanonicalSystemKey: index === 0 ? "transport" : null,
      context: {
        line_item: {
          id: lineItemId,
          transaction_id: `tx-${lineItemId}`,
          title: `Item ${index + 1}`,
          amount: 100 + index,
          quantity: 1,
          unit: "pcs",
          line_status: "final",
          category_id: index === 0 ? "cat-transport" : null,
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
          id: `tx-${lineItemId}`,
          payer_person_id: "person-1",
          account_id: "account-1",
          source: "tbank",
          posted_at: "2026-03-10T10:00:00.000Z",
          amount: 100 + index,
          currency: "RUB",
          transaction_type: "expense",
          status: "posted",
          merchant_name: "Synthetic Cafe",
          mcc: "5814",
          comment: "synthetic",
          source_comment: "",
          source_category_id: "coffee",
          source_category_name: "Coffee",
          cashback_amount: null,
          brand_id: null,
          is_transfer: false,
          raw_payload: {},
        },
        account: {
          source: "tbank",
          account_kind: "debit",
        },
        current_category: {
          id: index === 0 ? "cat-transport" : null,
          kind: index === 0 ? "canonical" : null,
          canonical_category_id: index === 0 ? "cat-transport" : null,
          canonical_system_key: index === 0 ? "transport" : null,
        },
        derived: {
          normalized_line_item_title: `item ${index + 1}`,
          normalized_merchant_name: "synthetic cafe",
          absolute_line_item_amount: 100 + index,
          unit_price: 100 + index,
          posted_day_of_week: 2,
          posted_month: 3,
          current_category_kind: index === 0 ? "canonical" : null,
          current_canonical_system_key: index === 0 ? "transport" : null,
          has_receipt_metadata: true,
        },
      },
    })),
  };
}

async function assertThrowsWithMessage(
  fn: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  let thrown: unknown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assertEquals((thrown as Error | null)?.message ?? null, expectedMessage);
}

Deno.test("callJevMoneyCategorizeBatch applies high-confidence Choice+Noul", async () => {
  const result = await callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
    apiKey: "key",
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          model: DEFAULT_JEV_MODEL,
          answers: {
            category: {
              choice: "cat-food",
              probabilities: { "cat-food": 0.9, "cat-transport": 0.1 },
              confidence: 0.9,
            },
            any_fit: { noul: 0.4 },
          },
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch,
  });

  assertEquals(result.model, DEFAULT_JEV_MODEL);
  assertEquals(result.items[0].categoryId, "cat-food");
  assertEquals(result.items[0].lineItemId, "line-1");
  assertEquals(result.promptTokens, 10);
  assertEquals(result.completionTokens, 2);
});

Deno.test(
  "callJevMoneyCategorizeBatch keeps existing category when probability is low",
  async () => {
    const result = await callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
      apiKey: "key",
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            answers: {
              category: {
                choice: "cat-food",
                probabilities: { "cat-food": 0.4, "cat-transport": 0.3 },
                confidence: 0.4,
              },
              any_fit: { noul: 0.9 },
            },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as typeof fetch,
    });

    assertEquals(result.items[0].categoryId, null);
    assertEquals((result.items[0].reason ?? "").includes("probability"), true);
  },
);

Deno.test("callJevMoneyCategorizeBatch keeps existing category when Noul is low", async () => {
  const result = await callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
    apiKey: "key",
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          answers: {
            category: {
              choice: "cat-food",
              probabilities: { "cat-food": 0.95 },
              confidence: 0.95,
            },
            any_fit: { noul: 0.1 },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch,
  });

  assertEquals(result.items[0].categoryId, null);
  assertEquals((result.items[0].reason ?? "").includes("Noul"), true);
});

Deno.test(
  "callJevMoneyCategorizeBatch throws on API error without inventing a category",
  async () => {
    await assertThrowsWithMessage(
      () =>
        callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
          apiKey: "key",
          fetchFn: (async () =>
            new Response(JSON.stringify({ error: { type: "authentication_error" } }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            })) as typeof fetch,
        }),
      "Jev request failed: 401",
    );
  },
);

Deno.test("callJevMoneyCategorizeBatch maps aborts to timeout error", async () => {
  await assertThrowsWithMessage(
    () =>
      callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
        apiKey: "key",
        timeoutMs: 1,
        fetchFn: ((_input, init) =>
          new Promise((_resolve, reject) => {
            const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
            signal?.addEventListener("abort", () => {
              reject(new DOMException("The signal has been aborted", "AbortError"));
            });
          })) as typeof fetch,
      }),
    "Jev request timed out",
  );
});

Deno.test(
  "callJevMoneyCategorizeBatch rejects unavailable provider by missing key upstream",
  async () => {
    // Wiring throws before fetch when key missing; client itself requires apiKey string.
    // Simulate empty key path by refusing Authorization-less calls in fetch:
    await assertThrowsWithMessage(
      () =>
        callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
          apiKey: "",
          fetchFn: (async (_input, init) => {
            const headers =
              (init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
            const auth = headers.Authorization ?? "";
            if (!auth.includes("Bearer ") || auth.endsWith("Bearer ")) {
              return new Response("{}", { status: 403 });
            }
            return new Response("{}", { status: 200 });
          }) as typeof fetch,
        }),
      "Jev request failed: 403",
    );
  },
);
