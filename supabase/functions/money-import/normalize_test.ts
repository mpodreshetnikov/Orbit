import { assertEquals } from "std/assert/assert-equals";
import {
  buildBalancingLineItem,
  buildLineItemImportHash,
  buildTransactionInsertPayload,
  getBearerToken,
  hasOnlySyntheticImportLineItems,
  hasRealImportLineItems,
  isSyntheticImportLineItem,
  jsonResponse,
  normalizeLineItems,
  normalizeSourceForTransactions,
  normalizeText,
  normalizeTransactionRow,
  toIsoOrNull,
  toNumberOrNull,
  extractAccountHintFromRow,
} from "./normalize.ts";
import type { CanonicalTransactionRowInput } from "./types.ts";

Deno.test("normalize helpers parse iso and numeric values", () => {
  assertEquals(toIsoOrNull("2026-01-01"), "2026-01-01T00:00:00.000Z");
  assertEquals(toIsoOrNull(""), null);
  assertEquals(toIsoOrNull("not-a-date"), null);

  assertEquals(toNumberOrNull(42), 42);
  assertEquals(toNumberOrNull("42.5"), 42.5);
  assertEquals(toNumberOrNull("x"), null);
  assertEquals(toNumberOrNull(null), null);
});

Deno.test("normalizeText trims and nulls empty values", () => {
  assertEquals(normalizeText("  abc "), "abc");
  assertEquals(normalizeText("   "), null);
  assertEquals(normalizeText(123), null);
});

Deno.test("normalizeTransactionRow fills defaults and normalizes fields", () => {
  const normalized = normalizeTransactionRow(
    {
      posted_at: "2026-01-10",
      amount: "100.5" as unknown as number,
      transaction_type: "",
      source: "  ",
      merchant_name: " Shop ",
      line_items: null,
    },
    "tbank",
  );

  assertEquals(normalized.posted_at, "2026-01-10T00:00:00.000Z");
  assertEquals(normalized.amount, 100.5);
  assertEquals(normalized.source, "tbank");
  assertEquals(normalized.currency, "RUB");
  assertEquals(normalized.status, "posted");
  assertEquals(normalized.transaction_type, "expense");
  assertEquals(normalized.merchant_name, "Shop");
  assertEquals(normalized.line_items?.length, 1);
});

Deno.test(
  "normalizeTransactionRow and insert payload keep source_comment and cashback fields",
  () => {
    const normalized = normalizeTransactionRow(
      {
        posted_at: "2026-01-10",
        amount: "100.5" as unknown as number,
        transaction_type: "expense",
        source: "tbank_web",
        source_comment: "  Paid by card  ",
        cashback_amount: "12.34" as unknown as number,
        cashback_currency: " rub ",
        operation_icon_url: "https://cdn.example.com/icon.png",
        source_category: {
          id: "cat-1",
          name: "Food",
        },
        source_brand: {
          source_key: "brand-1",
          name: "Shop",
          website_url: "https://shop.test",
          logo_url: "https://shop.test/logo.png",
          base_color: "ff0000",
          base_text_color: "ffffff",
        },
        line_items: null,
      },
      "tbank",
    );

    assertEquals(normalized.source_comment, "Paid by card");
    assertEquals(normalized.cashback_amount, 12.34);
    assertEquals(normalized.cashback_currency, "RUB");
    assertEquals(normalized.operation_icon_url, "https://cdn.example.com/icon.png");
    assertEquals(normalized.source_category, { id: "cat-1", name: "Food" });
    assertEquals(normalized.source_brand, {
      source_key: "brand-1",
      name: "Shop",
      website_url: "https://shop.test/",
      logo_url: "https://shop.test/logo.png",
      base_color: "ff0000",
      base_text_color: "ffffff",
    });

    const payload = buildTransactionInsertPayload(normalized, "person-1");
    assertEquals(payload.source_comment, "Paid by card");
    assertEquals(payload.cashback_amount, 12.34);
    assertEquals(payload.cashback_currency, "RUB");
    assertEquals(payload.operation_icon_url, "https://cdn.example.com/icon.png");
    assertEquals(payload.source_category_id, "cat-1");
    assertEquals(payload.source_category_name, "Food");
  },
);

Deno.test(
  "normalizeTransactionRow does not synthesize source_brand from merchant_name alone",
  () => {
    const normalized = normalizeTransactionRow(
      {
        posted_at: "2026-01-10",
        amount: 100.5,
        transaction_type: "expense",
        source: "tbank_web",
        merchant_name: "Закрытие вклада Т-Банк",
        line_items: null,
      },
      "tbank",
    );

    assertEquals(normalized.merchant_name, "Закрытие вклада Т-Банк");
    assertEquals(normalized.source_brand, null);
  },
);

Deno.test("normalizeTransactionRow drops explicit bank-native source_brand labels", () => {
  const normalized = normalizeTransactionRow(
    {
      posted_at: "2026-01-10",
      amount: 100.5,
      transaction_type: "expense",
      source: "tbank_web",
      merchant_name: "Внутрибанковский перевод",
      source_brand: {
        source_key: "native-transfer",
        name: "Внутрибанковский перевод 3-м лицам",
      },
      line_items: null,
    },
    "tbank",
  );

  assertEquals(normalized.source_brand, null);
});

Deno.test(
  "normalizeTransactionRow derives source_comment and cashback from raw payload when missing",
  () => {
    const normalized = normalizeTransactionRow(
      {
        posted_at: "2026-03-06T01:09:11.000Z",
        amount: 6500,
        transaction_type: "income",
        source: "tbank",
        comment: "В дек/янв за налог?",
        raw_payload: {
          operation: {
            message: "В дек/янв за налог?",
            cashback: 0,
            cashbackAmount: {
              value: 0,
              currency: { code: 643, name: "RUB", strCode: "643" },
            },
            loyaltyBonusSummary: {
              amount: 101,
            },
          },
        },
        line_items: [{ title: "Transfer", amount: 6500 }],
      },
      "tbank",
    );

    assertEquals(normalized.comment, "В дек/янв за налог?");
    assertEquals(normalized.source_comment, "В дек/янв за налог?");
    assertEquals(normalized.cashback_amount, 101);
    assertEquals(normalized.cashback_currency, "RUB");
  },
);

Deno.test("normalizeTransactionRow throws on invalid posted_at and amount", () => {
  let caughtPostedAt: unknown = null;
  try {
    normalizeTransactionRow(
      {
        posted_at: "bad-date",
        amount: 10,
        transaction_type: "expense",
      },
      "manual",
    );
  } catch (error) {
    caughtPostedAt = error;
  }
  assertEquals((caughtPostedAt as Error).message, "Invalid posted_at");

  let caughtAmount: unknown = null;
  try {
    normalizeTransactionRow(
      {
        posted_at: "2026-01-01",
        amount: Number.NaN,
        transaction_type: "expense",
      },
      "manual",
    );
  } catch (error) {
    caughtAmount = error;
  }
  assertEquals((caughtAmount as Error).message, "Invalid amount");
});

Deno.test("extractAccountHintFromRow returns last 4 digits", () => {
  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-01-01",
      amount: 1,
      transaction_type: "expense",
      raw_payload: { account_hint: "Card **** 1234" },
    }),
    "1234",
  );
  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-01-01",
      amount: 1,
      transaction_type: "expense",
      raw_payload: { account_hint: "no digits" },
    }),
    null,
  );
  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-01-01",
      amount: 1,
      transaction_type: "expense",
      account_hint: "primary card **** 4321",
    }),
    "4321",
  );
  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-01-01",
      amount: 1,
      transaction_type: "expense",
      raw_payload: {
        operation: {
          cardNumber: "220070******6986",
        },
      },
    }),
    "6986",
  );
  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-01-01",
      amount: 1,
      transaction_type: "expense",
      raw_payload: {
        operation: {
          payment: {
            cardNumber: "553691******0666",
          },
        },
      },
    }),
    "0666",
  );
});

Deno.test("extractAccountHintFromRow suppresses account-native and ambiguous hints", () => {
  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-03-02T01:28:47.000Z",
      amount: 62500,
      transaction_type: "transfer",
      is_transfer: true,
      raw_payload: {
        account_hint: null,
        operation: {
          description: "Между своими счетами",
          merchantKey: "Между своими счетами",
          group: "TRANSFER",
          cardNumber: "518901******1807",
          payment: {
            cardNumber: "518901******0926",
          },
        },
      },
    }),
    null,
  );

  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-03-08T01:41:48.000Z",
      amount: 10000,
      transaction_type: "income",
      raw_payload: {
        operation: {
          description: "Максим П.",
          subgroup: { name: "Пополнение по номеру телефона" },
          spendingCategory: { name: "Переводы" },
          categoryInfo: {
            bankCategory: { name: "Переводы" },
          },
          cardNumber: "220070******1778",
        },
      },
    }),
    null,
  );

  assertEquals(
    extractAccountHintFromRow({
      posted_at: "2026-03-08T02:38:02.000Z",
      amount: 507.93,
      transaction_type: "income",
      raw_payload: {
        operation: {
          description: "Проценты на остаток",
          merchantKey: "Проценты на остаток",
          subgroup: { name: "Бонусы" },
          spendingCategory: { name: "Проценты" },
          categoryInfo: {
            bankCategory: { name: "Проценты" },
          },
          cardNumber: "220070******7770",
        },
      },
    }),
    null,
  );
});

Deno.test("buildLineItemImportHash is deterministic and index-sensitive", async () => {
  const first = await buildLineItemImportHash("tx-1", { title: "Coffee", amount: 10 }, 0);
  const second = await buildLineItemImportHash("tx-1", { title: "Coffee", amount: 10 }, 0);
  const third = await buildLineItemImportHash("tx-1", { title: "Coffee", amount: 10 }, 1);
  assertEquals(first, second);
  assertEquals(first === third, false);
});

Deno.test("getBearerToken extracts token case-insensitively", () => {
  const req = new Request("http://localhost", {
    headers: { authorization: "Bearer token-123" },
  });
  assertEquals(getBearerToken(req), "token-123");
  assertEquals(getBearerToken(new Request("http://localhost")), null);
});

Deno.test("jsonResponse and source normalization work", async () => {
  const response = jsonResponse({ ok: true }, 201);
  assertEquals(response.status, 201);
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals((await response.json()) as { ok: boolean }, { ok: true });

  assertEquals(normalizeSourceForTransactions("tbank_web"), "tbank");
  assertEquals(normalizeSourceForTransactions("manual"), "manual");
});

Deno.test("isSyntheticImportLineItem recognises the explicit placeholder flag", () => {
  // The extension marks its own fallbacks inside raw_payload.
  assertEquals(isSyntheticImportLineItem({ raw_payload: { source: "fallback" } }), true);
  assertEquals(isSyntheticImportLineItem({ raw_payload: { source: "dom_fallback" } }), true);

  // The CSV import puts the raw statement row in raw_payload, which has no `source` key at all.
  // Only the explicit flag identifies it.
  assertEquals(
    isSyntheticImportLineItem({
      raw_payload: { "Дата операции": "05.03.2026 10:00:00" },
      is_placeholder: true,
    }),
    true,
  );
  assertEquals(
    isSyntheticImportLineItem({ raw_payload: { "Дата операции": "05.03.2026 10:00:00" } }),
    false,
  );

  assertEquals(isSyntheticImportLineItem({ raw_payload: { source: "receipt" } }), false);
  assertEquals(isSyntheticImportLineItem(null), false);
});

Deno.test("placeholder aggregates see flagged line items", () => {
  const flagged = { title: "Whole amount", amount: -100, is_placeholder: true };
  const real = { title: "Milk", amount: -40, raw_payload: { source: "receipt" } };

  assertEquals(hasOnlySyntheticImportLineItems([flagged]), true);
  assertEquals(hasOnlySyntheticImportLineItems([flagged, real]), false);
  assertEquals(hasRealImportLineItems([flagged]), false);
  assertEquals(hasRealImportLineItems([flagged, real]), true);
});

Deno.test("normalizeLineItems marks the synthesized whole-amount line as a placeholder", () => {
  const row: CanonicalTransactionRowInput = {
    posted_at: "2026-03-05T10:00:00.000Z",
    amount: -1000,
    transaction_type: "expense",
    merchant_name: "Store",
  };
  const lineItems = normalizeLineItems(row);
  assertEquals(lineItems.length, 1);
  assertEquals(lineItems[0].is_placeholder, true);
  assertEquals(lineItems[0].amount, -1000);

  // A row that already carries a composition is returned untouched.
  const withReceipt = normalizeLineItems({
    ...row,
    line_items: [{ title: "Milk", amount: -1000 }],
  });
  assertEquals(withReceipt[0].is_placeholder, undefined);
});

Deno.test("buildBalancingLineItem closes the gap between receipt and operation", () => {
  const row: CanonicalTransactionRowInput = {
    posted_at: "2026-03-05T10:00:00.000Z",
    amount: 1000,
    transaction_type: "income",
  };

  const balancing = buildBalancingLineItem(row, [
    { title: "A", amount: 500 },
    { title: "B", amount: 440 },
  ]);
  assertEquals(balancing?.amount, 60);
  assertEquals((balancing?.raw_payload as Record<string, unknown>).source, "balancing");
  assertEquals((balancing?.raw_payload as Record<string, unknown>).delta, 60);
  assertEquals(balancing?.is_placeholder, undefined);
});

Deno.test("buildBalancingLineItem ignores rounding noise", () => {
  const row: CanonicalTransactionRowInput = {
    posted_at: "2026-03-05T10:00:00.000Z",
    amount: -100.005,
    transaction_type: "expense",
  };
  assertEquals(buildBalancingLineItem(row, [{ title: "A", amount: -100 }]), null);
  assertEquals(
    buildBalancingLineItem({ ...row, amount: -100 }, [{ title: "A", amount: -100 }]),
    null,
  );
});

Deno.test("buildBalancingLineItem rejects a receipt from a different operation", () => {
  const row: CanonicalTransactionRowInput = {
    posted_at: "2026-03-05T10:00:00.000Z",
    amount: 1000,
    transaction_type: "income",
  };

  let caught: unknown = null;
  try {
    buildBalancingLineItem(row, [{ title: "A", amount: 100 }]);
  } catch (error) {
    caught = error;
  }
  assertEquals(
    caught instanceof Error ? caught.message : null,
    "Receipt total does not match transaction amount",
  );
});
