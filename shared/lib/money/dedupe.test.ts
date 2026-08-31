import { describe, expect, it } from "vitest";
import {
  assignMoneyDedupeOccurrences,
  buildMoneyDedupeHash,
  buildMoneyDedupePayload,
  type MoneyDedupeInput,
} from "./dedupe";

function input(partial: Partial<MoneyDedupeInput> = {}): MoneyDedupeInput {
  return {
    source: "tbank",
    postedAtIso: "2026-02-01T09:30:00.000Z",
    amount: -120.5,
    currency: "RUB",
    merchantName: "Coffee Shop",
    accountHint: "1234",
    occurrence: 0,
    ...partial,
  };
}

describe("money dedupe formula", () => {
  it("builds a canonical payload", () => {
    expect(buildMoneyDedupePayload(input())).toBe(
      "tbank|2026-02-01T09:30:00.000Z|-120.50|RUB|coffee shop|1234|0",
    );
  });

  it("normalises so equivalent inputs agree", () => {
    // Offset notation, casing, padding and repeated spaces must not change the identity.
    expect(buildMoneyDedupePayload(input({ postedAtIso: "2026-02-01T12:30:00+03:00" }))).toBe(
      buildMoneyDedupePayload(input()),
    );
    expect(buildMoneyDedupePayload(input({ merchantName: "  Coffee   Shop " }))).toBe(
      buildMoneyDedupePayload(input()),
    );
    expect(buildMoneyDedupePayload(input({ currency: "rub" }))).toBe(
      buildMoneyDedupePayload(input()),
    );
    expect(buildMoneyDedupePayload(input({ amount: -120.5001 }))).toBe(
      buildMoneyDedupePayload(input()),
    );
  });

  it("treats a missing merchant and a missing account hint as empty", () => {
    expect(buildMoneyDedupePayload(input({ merchantName: null, accountHint: null }))).toBe(
      "tbank|2026-02-01T09:30:00.000Z|-120.50|RUB|||0",
    );
  });

  it("is stable for the same input and different across occurrences", async () => {
    const first = await buildMoneyDedupeHash(input());
    const again = await buildMoneyDedupeHash(input());
    const second = await buildMoneyDedupeHash(input({ occurrence: 1 }));

    expect(first).toBe(again);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any identity field changes", async () => {
    const base = await buildMoneyDedupeHash(input());
    for (const variant of [
      input({ source: "alfa" }),
      input({ postedAtIso: "2026-02-01T09:30:01.000Z" }),
      input({ amount: -120.51 }),
      input({ currency: "USD" }),
      input({ merchantName: "Tea Shop" }),
      input({ accountHint: "5678" }),
    ]) {
      expect(await buildMoneyDedupeHash(variant)).not.toBe(base);
    }
  });

  it("numbers repeats within a group in arrival order", () => {
    const rows = [
      { merchant: "Coffee Shop" },
      { merchant: "Coffee Shop" },
      { merchant: "Tea Shop" },
      { merchant: "Coffee Shop" },
    ];

    const numbered = assignMoneyDedupeOccurrences(rows, (row) => ({
      source: "tbank",
      postedAtIso: "2026-02-01T09:30:00.000Z",
      amount: -120.5,
      currency: "RUB",
      merchantName: row.merchant,
      accountHint: "1234",
    }));

    expect(numbered.map((row) => row.occurrence)).toEqual([0, 1, 0, 2]);
  });
});
