// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import {
  buildJevState,
  callJevMoneyCategorizeBatch,
  DEFAULT_JEV_MODEL,
  mapPoolCancelOnError,
} from "./jev-categorize.ts";
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
          card_id: null,
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
          id: "account-1",
          source: "tbank",
          account_kind: "debit",
          account_label: "Main",
        },
        card: {
          id: null,
          last4: null,
          card_label: null,
        },
        brand: {
          id: null,
          name: null,
          slug: null,
        },
        current_category: {
          id: index === 0 ? "cat-transport" : null,
          kind: index === 0 ? "canonical" : null,
          name_en: index === 0 ? "Transport" : null,
          name_ru: index === 0 ? "Транспорт" : null,
          system_key: index === 0 ? "transport" : null,
          canonical_category_id: index === 0 ? "cat-transport" : null,
          canonical_system_key: index === 0 ? "transport" : null,
        },
        receipt_sibling_items: [],
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

function okJevResponse(choice: string, probability: number, noul: number): Response {
  return new Response(
    JSON.stringify({
      model: DEFAULT_JEV_MODEL,
      answers: {
        category: {
          choice,
          probabilities: { [choice]: probability, "cat-transport": 1 - probability },
          confidence: probability,
        },
        any_fit: { noul },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

Deno.test("buildJevState includes eligible_categories for companion Noul", () => {
  const request = createBatchRequest(["line-1"]);
  const state = buildJevState(request.items[0], {
    "cat-food": "Еда / Food (food)",
    "cat-transport": "Транспорт / Transport (transport)",
  });
  assertEquals(Array.isArray(state.eligible_categories), true);
  assertEquals((state.eligible_categories as unknown[]).length, 2);
});

Deno.test("buildJevState exposes target_line_item vs receipt_sibling_items", () => {
  const request = createBatchRequest(["line-1"]);
  request.items[0].context.receipt_sibling_items = [
    {
      id: "line-sib",
      title: "Sibling juice",
      amount: 50,
      quantity: 1,
      unit: "pcs",
      line_status: "final",
      category_id: null,
      assignment_method: "import",
    },
  ];
  request.items[0].context.transaction.card_id = "card-9";
  request.items[0].context.card = { id: "card-9", last4: "1234", card_label: "Travel" };
  request.items[0].context.brand = { id: "brand-9", name: "Cafe", slug: "cafe" };
  request.items[0].context.account.account_label = "Travel debit";

  const state = buildJevState(request.items[0], {
    "cat-food": "Еда / Food (food)",
  });

  assertEquals((state.target_line_item as { id: string }).id, "line-1");
  assertEquals(
    (state.receipt_sibling_items as Array<{ id: string }>).map((item) => item.id),
    ["line-sib"],
  );
  assertEquals((state.card as { last4: string }).last4, "1234");
  assertEquals((state.brand as { name: string }).name, "Cafe");
  assertEquals((state.account as { account_label: string }).account_label, "Travel debit");
  assertEquals(state.line_item_title, undefined);
});

Deno.test("buildJevState keeps empty receipt_sibling_items for single-line receipts", () => {
  const request = createBatchRequest(["line-1"]);
  const state = buildJevState(request.items[0], { "cat-food": "Еда / Food (food)" });
  assertEquals(state.receipt_sibling_items, []);
});

Deno.test("callJevMoneyCategorizeBatch applies high-confidence Choice+Noul", async () => {
  const result = await callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
    apiKey: "key",
    fetchFn: (async () => okJevResponse("cat-food", 0.9, 0.7)) as typeof fetch,
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
      fetchFn: (async () => okJevResponse("cat-food", 0.4, 0.9)) as typeof fetch,
    });

    assertEquals(result.items[0].categoryId, null);
    assertEquals((result.items[0].reason ?? "").includes("probability"), true);
  },
);

Deno.test("callJevMoneyCategorizeBatch keeps existing category when Noul is low", async () => {
  const result = await callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
    apiKey: "key",
    fetchFn: (async () => okJevResponse("cat-food", 0.95, 0.1)) as typeof fetch,
  });

  assertEquals(result.items[0].categoryId, null);
  assertEquals((result.items[0].reason ?? "").includes("Noul"), true);
});

Deno.test("callJevMoneyCategorizeBatch abstains when probabilities are missing", async () => {
  const result = await callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
    apiKey: "key",
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          answers: {
            category: { choice: "cat-food", confidence: 0.9 },
            any_fit: { noul: 0.9 },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch,
  });

  assertEquals(result.items[0].categoryId, null);
  assertEquals((result.items[0].reason ?? "").includes("probability"), true);
});

Deno.test("callJevMoneyCategorizeBatch rejects choice outside the candidate list", async () => {
  const result = await callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
    apiKey: "key",
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          answers: {
            category: {
              choice: "cat-unknown",
              probabilities: { "cat-unknown": 0.99 },
              confidence: 0.99,
            },
            any_fit: { noul: 0.9 },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch,
  });

  assertEquals(result.items[0].categoryId, null);
  assertEquals((result.items[0].reason ?? "").includes("outside the allowed"), true);
});

Deno.test("callJevMoneyCategorizeBatch rejects invalid JSON body", async () => {
  await assertThrowsWithMessage(
    () =>
      callJevMoneyCategorizeBatch(createBatchRequest(["line-1"]), {
        apiKey: "key",
        fetchFn: (async () =>
          new Response("not-json{", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as typeof fetch,
      }),
    "Jev returned invalid JSON",
  );
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

Deno.test("mapPoolCancelOnError stops dequeuing and aborts peers after first failure", async () => {
  const started: number[] = [];
  const signals: AbortSignal[] = [];
  let throws = 0;

  let thrown: unknown = null;
  try {
    await mapPoolCancelOnError([0, 1, 2, 3, 4, 5], 2, async (value, _index, signal) => {
      started.push(value);
      signals.push(signal);
      if (value === 1) {
        throws += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("503");
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new DOMException("aborted", "AbortError"));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort);
        setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, 40);
      });
      return value;
    });
  } catch (error) {
    thrown = error;
  }

  assertEquals((thrown as Error | null)?.message ?? null, "503");
  assertEquals(throws, 1);
  // Only the first wave (concurrency 2) should start; later indexes must not dequeue.
  assertEquals(started.length <= 3, true);
  assertEquals(started.includes(5), false);
  assertEquals(
    signals.some((signal) => signal.aborted),
    true,
  );
});

Deno.test(
  "callJevMoneyCategorizeBatch aborts remaining workers after one HTTP failure",
  async () => {
    let calls = 0;
    const controllers: AbortSignal[] = [];

    await assertThrowsWithMessage(
      () =>
        callJevMoneyCategorizeBatch(createBatchRequest(["a", "b", "c", "d", "e", "f"]), {
          apiKey: "key",
          concurrency: 2,
          timeoutMs: 200,
          fetchFn: ((_input, init) => {
            calls += 1;
            const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
            if (signal) controllers.push(signal);
            if (calls === 2) {
              return Promise.resolve(
                new Response("{}", {
                  status: 503,
                  headers: { "Content-Type": "application/json" },
                }),
              );
            }
            return new Promise((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                reject(new DOMException("The signal has been aborted", "AbortError"));
              });
            });
          }) as typeof fetch,
        }),
      "Jev request failed: 503",
    );

    // Must not start a request for every item after the failure.
    assertEquals(calls < 6, true);
    assertEquals(
      controllers.some((signal) => signal.aborted),
      true,
    );
  },
);
