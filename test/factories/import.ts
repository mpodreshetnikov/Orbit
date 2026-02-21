import type { CanonicalTransactionRow } from "@/types/import";

export function makeImportRow(
  overrides: Partial<CanonicalTransactionRow> = {},
): CanonicalTransactionRow {
  return {
    source: "tbank",
    posted_at: "2026-01-01T10:00:00.000Z",
    amount: -100,
    currency: "RUB",
    transaction_type: "expense",
    status: "posted",
    is_transfer: false,
    line_items: [
      {
        title: "Default item",
        amount: -100,
      },
    ],
    ...overrides,
  };
}
