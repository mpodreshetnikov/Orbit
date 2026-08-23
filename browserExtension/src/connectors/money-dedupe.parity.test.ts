import { describe, expect, it } from "vitest";
import * as canonical from "@shared/lib/money/dedupe.js";
import * as extension from "./money-dedupe.js";

/**
 * The extension keeps its own copy of the money identity formula because its runtime cannot
 * import from `shared/` (see the header of `money-dedupe.ts`). Two copies of a hash formula
 * drift silently — the symptom is not a crash but every extension row re-importing as new —
 * so this pins them to each other over the inputs that make the two implementations differ
 * if anyone edits one of them: whitespace, case, timezone form, sign, and the rounding and
 * clamping rules that are easy to write slightly differently.
 */
const CASES: canonical.MoneyDedupeInput[] = [
  {
    source: "tbank",
    postedAtIso: "2026-03-14T09:26:53.000Z",
    amount: -1234.5,
    currency: "RUB",
    merchantName: "Пятёрочка",
    accountHint: "*1234",
    occurrence: 0,
  },
  {
    source: "  TBank  ",
    postedAtIso: "2026-03-14T12:26:53+03:00",
    amount: -1234.5,
    currency: "rub",
    merchantName: "  ПЯТЁРОЧКА  ",
    accountHint: null,
    occurrence: 1,
  },
  {
    source: "alfa",
    postedAtIso: "2026-01-01T00:00:00.123Z",
    amount: 0,
    currency: "USD",
    merchantName: "Multi   space\tname",
    accountHint: "  ",
    occurrence: 7,
  },
  {
    source: "alfa",
    postedAtIso: "not a date",
    amount: -0,
    currency: "eur",
    merchantName: null,
    accountHint: "*9999",
    occurrence: -3,
  },
  {
    source: "manual",
    postedAtIso: "2026-12-31T23:59:59.999Z",
    amount: Number.NaN,
    currency: "RUB",
    merchantName: "Rounding 2.345",
    accountHint: null,
    occurrence: 2.9,
  },
  {
    source: "manual",
    postedAtIso: "2026-06-30T21:00:00.000Z",
    amount: Number.POSITIVE_INFINITY,
    currency: "RUB",
    merchantName: "",
    accountHint: null,
    occurrence: 0,
  },
  {
    source: "tbank",
    postedAtIso: "2026-06-30T21:00:00.000Z",
    amount: 2.005,
    currency: "RUB",
    merchantName: "Half-kopeck",
    accountHint: null,
    occurrence: 0,
  },
];

describe("extension money dedupe formula", () => {
  it("builds the same payload as the shared implementation", () => {
    for (const input of CASES) {
      expect(extension.buildMoneyDedupePayload(input)).toBe(
        canonical.buildMoneyDedupePayload(input),
      );
    }
  });

  it("builds the same hash as the shared implementation", async () => {
    for (const input of CASES) {
      await expect(extension.buildMoneyDedupeHash(input)).resolves.toBe(
        await canonical.buildMoneyDedupeHash(input),
      );
    }
  });

  it("numbers repeated rows the same way as the shared implementation", () => {
    const rows = [...CASES, ...CASES, CASES[0]].map((input) => ({
      source: input.source,
      postedAtIso: input.postedAtIso,
      amount: input.amount,
      currency: input.currency,
      merchantName: input.merchantName,
      accountHint: input.accountHint,
    }));
    const read = (row: (typeof rows)[number]) => row;

    expect(extension.assignMoneyDedupeOccurrences(rows, read)).toEqual(
      canonical.assignMoneyDedupeOccurrences(rows, read),
    );
  });

  it("still produces a stable SHA-256, not just something matching", async () => {
    await expect(
      extension.buildMoneyDedupeHash({
        source: "tbank",
        postedAtIso: "2026-03-14T09:26:53.000Z",
        amount: -1234.5,
        currency: "RUB",
        merchantName: "Пятёрочка",
        accountHint: "*1234",
        occurrence: 0,
      }),
    ).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});
