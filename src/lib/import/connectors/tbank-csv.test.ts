import { describe, expect, it } from "vitest";
import {
  COL,
  extractAccountHint,
  isTransfer,
  parseAmount,
  parseCSV,
  parseTBankDate,
  tbankConnector,
} from "./tbank-csv";

function getTransferPair() {
  const source = isTransfer.toString();
  const match = source.match(/cat === "([^"]+)" && desc === "([^"]+)"/);
  if (!match) {
    throw new Error("Unable to extract transfer literals from isTransfer");
  }
  return { category: match[1], description: match[2] };
}

describe("tbank-csv connector", () => {
  it("returns error for missing data rows", async () => {
    const file = new File(["only one line"], "empty.csv", { type: "text/csv" });
    const result = await tbankConnector.parse(file);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual(["CSV has no header or data rows"]);
  });

  it("reports invalid date rows", async () => {
    const header = [
      COL.DATE_OP,
      COL.DATE_PAY,
      COL.CARD,
      COL.STATUS,
      COL.AMOUNT_OP,
      COL.CURRENCY_OP,
      COL.CATEGORY,
      COL.MCC,
      COL.DESCRIPTION,
    ].join(";");

    const row = [
      "bad-date",
      "",
      "**** 1234",
      "OK",
      "-120,50",
      "RUB",
      "Food",
      "5812",
      "Coffee",
    ].join(";");

    const file = new File([`${header}\n${row}\n`], "sample.csv", { type: "text/csv" });
    const result = await tbankConnector.parse(file);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual(["Row 2: invalid date"]);
  });

  it("covers CSV/date/amount/account helper edge cases", () => {
    expect(parseCSV('"a";"b"\r\n"c";"d"\n')).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCSV("a;b\r\n\r\nc;d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);

    expect(parseTBankDate("01.02.2026 12:30:05")).toBe("2026-02-01T12:30:05.000Z");
    expect(parseTBankDate("01.02.2026")).toBe("2026-02-01T00:00:00.000Z");
    expect(parseTBankDate("")).toBeNull();
    expect(parseTBankDate("2026-02-01")).toBeNull();

    expect(parseAmount(" 1 234,56 ")).toBe(1234.56);
    expect(parseAmount("oops")).toBe(0);

    expect(extractAccountHint("**** 1234")).toBe("1234");
    expect(extractAccountHint("  ** 12 ")).toBe("12");
    expect(extractAccountHint("   ")).toBe("");

    const transferPair = getTransferPair();
    expect(isTransfer("Food", "Coffee")).toBe(false);
    expect(isTransfer(transferPair.category, transferPair.description)).toBe(true);
  });

  it("parses valid rows including transfer and default fallbacks", async () => {
    const header = [
      COL.DATE_OP,
      COL.DATE_PAY,
      COL.CARD,
      COL.STATUS,
      COL.AMOUNT_OP,
      COL.CURRENCY_OP,
      COL.CATEGORY,
      COL.MCC,
      COL.DESCRIPTION,
    ].join(";");

    const transferPair = getTransferPair();
    const rows = [
      [
        "01.02.2026 12:30:00",
        "",
        "**** 1234",
        "OK",
        "-120,50",
        "RUB",
        "Food",
        "5812",
        "Coffee",
      ].join(";"),
      ["", "02.02.2026", "", "PENDING", "1000", "", "Salary", "", ""].join(";"),
      [
        "03.02.2026",
        "",
        "**** 5678",
        "OK",
        "-10,00",
        "RUB",
        transferPair.category,
        "",
        transferPair.description,
      ].join(";"),
    ];

    const file = new File([`${header}\n${rows.join("\n")}\n`], "sample.csv", { type: "text/csv" });
    const result = await tbankConnector.parse(file);

    expect(result.errors).toBeUndefined();
    expect(result.transactions).toHaveLength(3);

    expect(result.transactions[0]).toEqual(
      expect.objectContaining({
        posted_at: "2026-02-01T12:30:00.000Z",
        transaction_type: "expense",
        status: "posted",
        account_hint: "1234",
        merchant_name: "Coffee",
        mcc: "5812",
        is_transfer: false,
        source_category: {
          id: null,
          name: "Food",
        },
        source_brand: null,
        operation_icon_url: null,
      }),
    );
    expect(result.transactions[1]).toEqual(
      expect.objectContaining({
        posted_at: "2026-02-02T00:00:00.000Z",
        currency: "RUB",
        transaction_type: "income",
        status: "pending",
        account_hint: null,
        merchant_name: null,
        mcc: null,
        source_category: {
          id: null,
          name: "Salary",
        },
        source_brand: null,
      }),
    );
    expect(result.transactions[2]).toEqual(
      expect.objectContaining({
        transaction_type: "transfer",
        is_transfer: true,
        account_hint: "5678",
      }),
    );
    expect(result.transactions[1].line_items[0].title).toBe("T-Bank");
    expect(result.transactions[0].dedupe_hash).toEqual(expect.any(String));
  });

  it("marks the whole-amount statement line as a placeholder", async () => {
    const header = [
      COL.DATE_OP,
      COL.DATE_PAY,
      COL.CARD,
      COL.STATUS,
      COL.AMOUNT_OP,
      COL.CURRENCY_OP,
      COL.CATEGORY,
      COL.MCC,
      COL.DESCRIPTION,
    ].join(";");
    const row = [
      "01.02.2026 12:30:00",
      "01.02.2026",
      "**** 1234",
      "OK",
      "-120,50",
      "RUB",
      "Food",
      "5812",
      "Coffee",
    ].join(";");

    const file = new File([`${header}\n${row}\n`], "sample.csv", { type: "text/csv" });
    const result = await tbankConnector.parse(file);

    // A statement carries no receipt composition, so every line the CSV produces is a stand-in.
    // The flag is what lets a later extension import replace it instead of adding lines beside it.
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].line_items).toHaveLength(1);
    expect(result.transactions[0].line_items[0].is_placeholder).toBe(true);
    expect(result.transactions[0].line_items[0].amount).toBe(result.transactions[0].amount);
  });
});
