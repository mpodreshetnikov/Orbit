import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  isoDay,
  normalizeSpendingReport,
  type SpendingPeriod,
  type SpendingReport,
} from "@/types/money-spending-report";

/**
 * Agent-facing call of `money_get_spending_report` (T-261109-p1i / stream B).
 * Same RPC the web and phone already use after Orbit#240: sync FX for the period,
 * then return the normalised aggregate payload — totals, categories, days,
 * merchants, forecast — without the transaction feed.
 */

type Client = SupabaseClient<Database>;

type SpendingReportRpcClient = Client & {
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

export interface SpendingReportQuery {
  personId: string;
  period: Pick<SpendingPeriod, "start" | "end">;
  currency: string;
  accountIds: string[];
  categoryId: string | null;
  /** Calendar "today" for the forecast window; defaults to UTC today. */
  today?: string;
}

export async function fetchMoneySpendingReport(
  supabase: Client,
  query: SpendingReportQuery,
): Promise<SpendingReport> {
  const client = supabase as SpendingReportRpcClient;
  const today = query.today ?? isoDay(new Date());
  const syncEnd = query.period.end < today ? query.period.end : today;
  if (query.period.start <= syncEnd) {
    const { error: syncError } = await client.functions.invoke("money-fx-sync", {
      body: {
        start_date: query.period.start,
        end_date: syncEnd,
        base_currency: "USD",
        quote_currencies: ["RUB"],
      },
    });
    if (syncError) throw new Error(syncError.message);
  }

  const { data, error } = await client.rpc("money_get_spending_report", {
    p_person_id: query.personId,
    p_start: query.period.start,
    p_end: query.period.end,
    p_report_currency: query.currency,
    p_account_ids: query.accountIds.length > 0 ? query.accountIds : null,
    p_category_id: query.categoryId,
    p_today: today,
  });
  if (error) throw new Error(error.message);
  return normalizeSpendingReport(data);
}
