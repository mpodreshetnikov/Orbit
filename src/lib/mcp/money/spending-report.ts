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
  /**
   * Cap how long MCP waits on `money-fx-sync` before falling through to the
   * report RPC (daily cron / prior sync usually already filled rates). `0`
   * skips sync. Default 2s — long enough for a warm edge hit, short enough that
   * a stuck CBR fetch cannot burn the MCP client deadline (~60s → −32001).
   */
  fxSyncTimeoutMs?: number;
}

/** Default MCP FX wait: keep the report under the agent deadline when CBR/edge hangs. */
export const MONEY_MCP_FX_SYNC_TIMEOUT_MS = 2_000;

// Stryker disable all: timer race plumbing; FX skip/timeout behavior gated via fetchMoneySpendingReport tests
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | "timeout"> {
  if (timeoutMs <= 0) return "timeout";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
// Stryker restore all

export async function fetchMoneySpendingReport(
  supabase: Client,
  query: SpendingReportQuery,
): Promise<SpendingReport> {
  const client = supabase as SpendingReportRpcClient;
  const today = query.today ?? isoDay(new Date());
  // Stryker disable next-line EqualityOperator: end===today yields the same syncEnd either way
  const syncEnd = query.period.end < today ? query.period.end : today;
  const fxSyncTimeoutMs = query.fxSyncTimeoutMs ?? MONEY_MCP_FX_SYNC_TIMEOUT_MS;
  if (query.period.start <= syncEnd && fxSyncTimeoutMs > 0) {
    // Never throw on FX failure/timeout: the report RPC still has stored rates
    // (and fx_status). Blocking here was the prod −32001 for category spend.
    // Swallow invoke errors on the promise so a late reject after timeout is not unhandled.
    // Stryker disable all: FX invoke swallow; report RPC is the behavioral gate
    const sync = (async () => {
      try {
        return await client.functions.invoke("money-fx-sync", {
          body: {
            start_date: query.period.start,
            end_date: syncEnd,
            base_currency: "USD",
            quote_currencies: ["RUB"],
          },
        });
      } catch {
        return null;
      }
    })();
    // Stryker restore all
    await withTimeout(sync, fxSyncTimeoutMs);
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
