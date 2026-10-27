import { describe, expect, it } from "vitest";
import type { CanonicalTransactionRow } from "./import";
import { getAccountHint, importAccountHints, importBatchRows } from "./money-import-rows";
import { parseTBankCsv } from "./money-import-tbank-csv";

const row = (changes: Partial<CanonicalTransactionRow> = {}): CanonicalTransactionRow => ({
  source: "tbank",
  posted_at: "2026-10-01T10:00:00.000Z",
  amount: -100,
  currency: "RUB",
  transaction_type: "expense",
  status: "posted",
  merchant_name: "Пятёрочка",
  is_transfer: false,
  line_items: [{ title: "Пятёрочка", amount: -100 }],
  ...changes,
});

describe("getAccountHint", () => {
  it("reads the card's last four digits from the row, its payload or its operation", () => {
    expect(getAccountHint(row({ account_hint: "*1234" }))).toBe("1234");
    expect(getAccountHint(row({ raw_payload: { account_hint: "5678" } }))).toBe("5678");
    expect(
      getAccountHint(
        row({ raw_payload: { operation: { card: { panMasked: "220000******9012" } } } }),
      ),
    ).toBe("9012");
    expect(getAccountHint(row({ account_hint: "12" }))).toBeNull();
  });

  it("names no card for transfers, interest, or an operation naming two cards", () => {
    expect(getAccountHint(row({ account_hint: "1234", is_transfer: true }))).toBeNull();
    expect(
      getAccountHint(
        row({
          account_hint: "1234",
          raw_payload: { operation: { description: "Проценты на остаток" } },
        }),
      ),
    ).toBeNull();
    expect(
      getAccountHint(
        row({
          raw_payload: { operation: { cardNumber: "*1111", payment: { cardNumber: "*2222" } } },
        }),
      ),
    ).toBeNull();
  });
});

describe("the batch", () => {
  const rows = [row({ account_hint: "2222" }), row({ account_hint: "1111" }), row()];

  it("lists each card once", () => {
    expect(importAccountHints(rows)).toEqual(["1111", "2222"]);
  });

  it("names no account and keeps the card in its payload, for the server to resolve", () => {
    const batch = importBatchRows(rows);
    expect(batch).toHaveLength(3);
    expect(batch[0]).not.toHaveProperty("account_id");
    expect(batch[0]).toMatchObject({
      account_hint: "2222",
      card_id: null,
      external_id: null,
      raw_payload: { account_hint: "2222" },
      line_items: [{ title: "Пятёрочка", amount: -100 }],
    });
  });
});

describe("parseTBankCsv", () => {
  it("hashes each row with the hash it is given", async () => {
    const text =
      '"Дата операции";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Описание"\n' +
      '"01.10.2026 10:00:00";"*1234";"OK";"-100,50";"RUB";"Кофе"';
    const result = await parseTBankCsv(text, async (...parts) => parts.join("|"));
    expect(result.transactions[0]).toMatchObject({
      amount: -100.5,
      account_hint: "1234",
      dedupe_hash: "tbank|2026-10-01T10:00:00.000Z|-100.5|RUB|Кофе|1234",
    });
  });
});
