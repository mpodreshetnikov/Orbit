import { describe, expect, it } from "vitest";
import {
  applyMoneyDedupeHashes,
  assignMoneyDedupeOccurrences,
  buildMoneyDedupeHash,
  buildMoneyDedupePayload,
} from "./dedupe";

const baseInput = {
  source: "tbank",
  postedAtIso: "2026-02-01T12:30:00+03:00",
  amount: -120.5,
  currency: "RUB",
  merchantName: "Coffee",
  accountHint: "1234",
  occurrence: 0,
};

describe("money dedupe payload", () => {
  it("renders a canonical payload the SQL twin can reproduce", () => {
    // These exact strings are asserted again in
    // supabase/tests/functions/money_dedupe_payload_test.sql against
    // public.money_build_dedupe_payload. If one side changes, both tests must change together —
    // drift means re-importing a statement creates a second copy of every row.
    expect(buildMoneyDedupePayload(baseInput)).toBe(
      "tbank|2026-02-01T09:30:00.000Z|-120.50|RUB|Coffee|1234|0",
    );
    expect(buildMoneyDedupePayload({ ...baseInput, occurrence: 1 })).toBe(
      "tbank|2026-02-01T09:30:00.000Z|-120.50|RUB|Coffee|1234|1",
    );
    expect(
      buildMoneyDedupePayload({
        source: "tbank",
        postedAtIso: "2026-02-02T00:00:00+03:00",
        amount: 5000,
        currency: "RUB",
        merchantName: null,
        accountHint: null,
        occurrence: 0,
      }),
    ).toBe("tbank|2026-02-01T21:00:00.000Z|5000.00|RUB|||0");
  });

  it("treats an offset instant and the same instant in UTC as one value", () => {
    expect(buildMoneyDedupePayload(baseInput)).toBe(
      buildMoneyDedupePayload({ ...baseInput, postedAtIso: "2026-02-01T09:30:00.000Z" }),
    );
  });

  it("canonicalises amount precision, currency case and surrounding space", () => {
    expect(buildMoneyDedupePayload({ ...baseInput, amount: -120.5 })).toBe(
      buildMoneyDedupePayload({ ...baseInput, amount: -120.5000001 }),
    );
    expect(buildMoneyDedupePayload({ ...baseInput, currency: " rub " })).toBe(
      buildMoneyDedupePayload(baseInput),
    );
    expect(buildMoneyDedupePayload({ ...baseInput, merchantName: "  Coffee  " })).toBe(
      buildMoneyDedupePayload(baseInput),
    );
  });

  it("never renders negative zero", () => {
    expect(buildMoneyDedupePayload({ ...baseInput, amount: -0 })).toContain("|0.00|");
  });
});

describe("money dedupe hash", () => {
  it("is stable for the same input", async () => {
    expect(await buildMoneyDedupeHash(baseInput)).toBe(await buildMoneyDedupeHash(baseInput));
  });

  it("matches the digest the SQL side is expected to produce", async () => {
    expect(await buildMoneyDedupeHash(baseInput)).toBe(
      "429706684e66e43626026281bc0b84f955df00f25e8af76fee7caddd79481fb4",
    );
  });

  it("separates two otherwise identical purchases", async () => {
    // Without the occurrence these hash alike, and the second purchase disappears as a duplicate.
    expect(await buildMoneyDedupeHash({ ...baseInput, occurrence: 1 })).not.toBe(
      await buildMoneyDedupeHash(baseInput),
    );
  });

  it("is a full SHA-256, not a 32-bit digest", async () => {
    expect(await buildMoneyDedupeHash(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("occurrence assignment", () => {
  it("numbers repetitions within a group in arrival order", () => {
    const withoutOccurrence = {
      source: baseInput.source,
      postedAtIso: baseInput.postedAtIso,
      amount: baseInput.amount,
      currency: baseInput.currency,
      merchantName: baseInput.merchantName,
      accountHint: baseInput.accountHint,
    };

    const assigned = assignMoneyDedupeOccurrences([
      withoutOccurrence,
      { ...withoutOccurrence, merchantName: "Tea" },
      withoutOccurrence,
      withoutOccurrence,
    ]);

    expect(assigned.map((row) => row.occurrence)).toEqual([0, 0, 1, 2]);
  });
});

describe("applyMoneyDedupeHashes", () => {
  it("fills dedupe_hash on every row and distinguishes repeated rows", async () => {
    const rows: Array<Record<string, unknown>> = [
      {
        source: "tbank",
        posted_at: "2026-02-01T12:30:00+03:00",
        amount: -120.5,
        currency: "RUB",
        merchant_name: "Coffee",
        raw_payload: { account_hint: "1234" },
        dedupe_hash: null,
      },
      {
        source: "tbank",
        posted_at: "2026-02-01T12:30:00+03:00",
        amount: -120.5,
        currency: "RUB",
        merchant_name: "Coffee",
        raw_payload: { account_hint: "1234" },
        dedupe_hash: null,
      },
    ];

    await applyMoneyDedupeHashes(rows, (row) => {
      const rawPayload = row.raw_payload as Record<string, unknown> | null;
      const hint = rawPayload?.account_hint;
      return typeof hint === "string" ? hint : null;
    });

    expect(rows[0].dedupe_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1].dedupe_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].dedupe_hash).not.toBe(rows[1].dedupe_hash);
  });
});
