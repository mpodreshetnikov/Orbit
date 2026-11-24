/**
 * Transactions-feed deep-link query for the money spending report (T-261028-yhm).
 *
 * Kept out of the shared spending-report module so incremental mutation stays small.
 */

import type { SpendingReportMode } from "./money-spending-report";

/** Ledger query for the report's period/accounts/category/merchant filters. */
export function transactionsFeedQuery(input: {
  start: string;
  end: string;
  accountIds?: string[];
  categoryId?: string | null;
  merchantName?: string | null;
  mode?: SpendingReportMode;
}): string {
  const params = new URLSearchParams();
  params.set("preset", "custom");
  params.set("from", `${input.start}T00:00:00.000Z`);
  params.set("to", `${input.end}T23:59:59.999Z`);
  if (input.accountIds && input.accountIds.length > 0) {
    params.set("accounts", input.accountIds.join(","));
  }
  if (input.categoryId) params.set("categories", input.categoryId);
  if (input.merchantName) params.set("q", input.merchantName);
  if (input.mode === "expense" || input.mode === "income") params.set("sign", input.mode);
  return params.toString();
}
