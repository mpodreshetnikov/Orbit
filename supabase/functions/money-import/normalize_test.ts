import { assertEquals } from "std/assert/assert-equals";
import {
  buildLineItemImportHash,
  getBearerToken,
  jsonResponse,
  normalizeSourceForTransactions,
  normalizeText,
  normalizeTransactionRow,
  toIsoOrNull,
  toNumberOrNull,
  extractAccountHintFromRow,
} from "./normalize.ts";

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
