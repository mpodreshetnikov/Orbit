// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { callOpenRouterMoneyCategorizeBatch } from "./openrouter-categorize.ts";
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
      config: { prompt: "Pick the best category." },
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
        id: "cat-coffee",
        name_en: "Coffee",
        name_ru: "Кофе",
        slug: "coffee",
        category_kind: "custom",
        canonical_category_id: "cat-food",
        canonical_system_key: "food",
      },
    ],
    items: lineItemIds.map((lineItemId, index) => ({
      lineItemId,
      currentCategoryId: null,
      currentCanonicalSystemKey: null,
      context: {
        line_item: {
          id: lineItemId,
          transaction_id: `tx-${lineItemId}`,
          title: `Item ${index + 1}`,
          amount: 100 + index,
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
          id: `tx-${lineItemId}`,
          payer_person_id: "person-1",
          account_id: "account-1",
          source: "tbank",
          posted_at: "2026-03-10T10:00:00.000Z",
          amount: 100 + index,
          currency: "RUB",
          transaction_type: "expense",
          status: "posted",
          merchant_name: "Coffee House",
          mcc: "5814",
          comment: "",
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
          id: null,
          kind: null,
          canonical_category_id: null,
          canonical_system_key: null,
        },
        derived: {
          normalized_line_item_title: `item ${index + 1}`,
          normalized_merchant_name: "coffee house",
          absolute_line_item_amount: 100 + index,
          unit_price: 100 + index,
          posted_day_of_week: 2,
          posted_month: 3,
          current_category_kind: null,
          current_canonical_system_key: null,
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

function asRecord(value: Record<string, unknown> | null): Record<string, unknown> {
  return value ?? {};
}

Deno.test(
  "callOpenRouterMoneyCategorizeBatch sends one batched request and parses strict JSON",
  async () => {
    let requestBody: Record<string, unknown> | null = null;

    const result = await callOpenRouterMoneyCategorizeBatch(
      createBatchRequest(["line-1", "line-2"]),
      {
        fetchFn: (async (_input, init) => {
          requestBody = JSON.parse(
            String((init as { body?: BodyInit | null } | undefined)?.body ?? "{}"),
          );
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: [
                        {
                          line_item_id: "line-1",
                          category_id: "cat-coffee",
                          reason: "Specific drink category",
                        },
                        {
                          line_item_id: "line-2",
                          category_id: null,
                          reason: "Not confident enough",
                        },
                      ],
                    }),
                  },
                },
              ],
              usage: {
                prompt_tokens: 120,
                completion_tokens: 18,
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }) as typeof fetch,
        apiKey: "key",
      },
    );

    assertEquals(asRecord(requestBody).model, "google/gemini-2.0-flash-001");
    assertEquals(asRecord(requestBody).response_format, { type: "json_object" });
    assertEquals(result.model, "google/gemini-2.0-flash-001");
    assertEquals(result.promptTokens, 120);
    assertEquals(result.completionTokens, 18);
    assertEquals(result.items, [
      {
        lineItemId: "line-1",
        categoryId: "cat-coffee",
        reason: "Specific drink category",
        rawResponse: {
          line_item_id: "line-1",
          category_id: "cat-coffee",
          reason: "Specific drink category",
        },
      },
      {
        lineItemId: "line-2",
        categoryId: null,
        reason: "Not confident enough",
        rawResponse: {
          line_item_id: "line-2",
          category_id: null,
          reason: "Not confident enough",
        },
      },
    ]);
  },
);

Deno.test(
  "callOpenRouterMoneyCategorizeBatch keeps valid item results from a partially malformed payload",
  async () => {
    const result = await callOpenRouterMoneyCategorizeBatch(
      createBatchRequest(["line-1", "line-2"]),
      {
        fetchFn: (async () => {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: [
                        {
                          line_item_id: "line-1",
                          category_id: "cat-food",
                          reason: "Valid item",
                        },
                        {
                          category_id: "cat-coffee",
                          reason: "Missing line item id should be ignored",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }) as typeof fetch,
        apiKey: "key",
        model: "custom-model",
      },
    );

    assertEquals(result.model, "custom-model");
    assertEquals(result.items, [
      {
        lineItemId: "line-1",
        categoryId: "cat-food",
        reason: "Valid item",
        rawResponse: {
          line_item_id: "line-1",
          category_id: "cat-food",
          reason: "Valid item",
        },
      },
    ]);
  },
);

Deno.test("callOpenRouterMoneyCategorizeBatch rejects malformed batch envelopes", async () => {
  await assertThrowsWithMessage(
    () =>
      callOpenRouterMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
        fetchFn: (async () => {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ category_id: "cat-food" }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }) as typeof fetch,
        apiKey: "key",
      }),
    "OpenRouter returned invalid batch JSON content",
  );
});

Deno.test("callOpenRouterMoneyCategorizeBatch maps aborts to timeout error", async () => {
  await assertThrowsWithMessage(
    () =>
      callOpenRouterMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
        fetchFn: ((_input, init) =>
          new Promise((_resolve, reject) => {
            const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
            signal?.addEventListener("abort", () => {
              reject(new DOMException("The signal has been aborted", "AbortError"));
            });
          })) as typeof fetch,
        apiKey: "key",
        timeoutMs: 1,
      }),
    "OpenRouter request timed out",
  );
});
