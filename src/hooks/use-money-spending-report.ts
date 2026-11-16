"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import {
  spendingReportMerchantQueryKey,
  spendingReportMerchantRpcArgs,
} from "@/hooks/money-spending-report-rpc";
import { spendingReportFxSyncRange } from "@/hooks/money-spending-report-sync";
import { isoDay, type SpendingPeriod } from "@/types/money-spending-report";
import {
  normalizeSpendingReport,
  type SpendingReport,
} from "@/types/money-spending-report-ux";

type SupabaseMoneyReportClient = ReturnType<typeof createClient> & {
  rpc: (
    fn: "money_get_spending_report",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  functions: {
    invoke: (
      fn: "money-fx-sync",
      options: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

export interface MoneySpendingReportRequest {
  personId: string;
  period: Pick<SpendingPeriod, "start" | "end">;
  currency: string;
  accountIds: string[];
  categoryId: string | null;
  brandId?: string | null;
  merchantName?: string | null;
}

/**
 * Spending report with UX normalize + optional brand/merchant filters (T-261028-yhm).
 * Lives outside `use-money-reports` so that module can stay identical to main for mutation.
 */
async function fetchMoneySpendingReport(
  request: MoneySpendingReportRequest,
): Promise<SpendingReport> {
  const supabase = createClient() as SupabaseMoneyReportClient;
  const today = isoDay(new Date());
  const syncRange = spendingReportFxSyncRange(request.period, today);
  if (syncRange) {
    const { error: syncError } = await supabase.functions.invoke("money-fx-sync", {
      body: {
        start_date: syncRange.start,
        end_date: syncRange.end,
        base_currency: "USD",
        quote_currencies: ["RUB"],
      },
    });
    if (syncError) throw new Error(syncError.message);
  }

  const { data, error } = await supabase.rpc("money_get_spending_report", {
    p_person_id: request.personId,
    p_start: request.period.start,
    p_end: request.period.end,
    p_report_currency: request.currency,
    p_account_ids: request.accountIds.length > 0 ? request.accountIds : null,
    p_category_id: request.categoryId,
    ...spendingReportMerchantRpcArgs(request),
  });
  if (error) throw new Error(error.message);
  return normalizeSpendingReport(data);
}

/** Stable React Query key; account ids are sorted so order does not fragment the cache. */
export function moneySpendingReportQueryKey(
  request: Omit<MoneySpendingReportRequest, "personId"> & { personId: string | null },
): unknown[] {
  const { personId, period, currency, accountIds, categoryId, brandId, merchantName } = request;
  return [
    "money-spending-report",
    personId,
    period.start,
    period.end,
    currency,
    [...accountIds].sort().join(","),
    categoryId,
    ...spendingReportMerchantQueryKey({ brandId, merchantName }),
  ];
}

export function useMoneySpendingReport(
  request: Omit<MoneySpendingReportRequest, "personId"> & {
    personId: string | null;
  },
) {
  return useQuery({
    queryKey: moneySpendingReportQueryKey(request),
    queryFn: () =>
      fetchMoneySpendingReport({
        personId: request.personId!,
        period: request.period,
        currency: request.currency,
        accountIds: request.accountIds,
        categoryId: request.categoryId,
        brandId: request.brandId,
        merchantName: request.merchantName,
      }),
    enabled: Boolean(request.personId),
    // Stryker disable next-line ArrowFunction: identity placeholder; () => undefined drops prior data
    placeholderData: (previous) => previous,
  });
}
