"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import {
  spendingReportMerchantQueryKey,
  spendingReportMerchantRpcArgs,
} from "@/hooks/money-spending-report-rpc";
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
  const syncEnd = request.period.end < today ? request.period.end : today;
  if (request.period.start <= syncEnd) {
    const { error: syncError } = await supabase.functions.invoke("money-fx-sync", {
      body: {
        start_date: request.period.start,
        end_date: syncEnd,
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

export function useMoneySpendingReport(
  request: Omit<MoneySpendingReportRequest, "personId"> & {
    personId: string | null;
  },
) {
  const { personId, period, currency, accountIds, categoryId, brandId, merchantName } = request;
  return useQuery({
    queryKey: [
      "money-spending-report",
      personId,
      period.start,
      period.end,
      currency,
      [...accountIds].sort().join(","),
      categoryId,
      ...spendingReportMerchantQueryKey({ brandId, merchantName }),
    ],
    queryFn: () =>
      fetchMoneySpendingReport({
        personId: personId!,
        period,
        currency,
        accountIds,
        categoryId,
        brandId,
        merchantName,
      }),
    enabled: Boolean(personId),
    placeholderData: (previous) => previous,
  });
}
