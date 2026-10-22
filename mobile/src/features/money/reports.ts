import type { MoneyBudgetReport } from "@orbit-types/money";
import { normalizeBudgetReport, resolveMoneyFxSyncRange } from "@orbit-types/money-reports";
import { supabase } from "@/lib/supabase";

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The month's budget report for the person, in `currency`. As on the web, the month's exchange
 * rates are brought up to date first, so the report converts with today's rates.
 */
export async function fetchBudgetReport(
  personId: string,
  monthStart: string,
  currency: string,
): Promise<MoneyBudgetReport> {
  const range = resolveMoneyFxSyncRange(monthStart);
  if (range) {
    check(
      await supabase.functions.invoke("money-fx-sync", {
        body: {
          start_date: range.startDate,
          end_date: range.endDate,
          base_currency: "USD",
          quote_currencies: ["RUB"],
        },
      }),
    );
  }
  const data = check(
    await supabase.rpc("money_get_budget_report", {
      p_person_id: personId,
      p_month_start: monthStart,
      p_report_currency: currency,
    }),
  ) as unknown;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  return normalizeBudgetReport(row ?? null);
}

export interface TargetKey {
  personId: string;
  categoryId: string;
  monthStart: string;
}

/** Set a category's target for the month, or remove it when `amount` is null. */
export async function saveBudgetTarget(
  key: TargetKey,
  amount: number | null,
  currency: string,
): Promise<void> {
  const table = supabase.from("money_budget_targets");
  if (amount === null) {
    check(
      await table
        .delete()
        .eq("person_id", key.personId)
        .eq("category_id", key.categoryId)
        .eq("month_start", key.monthStart),
    );
    return;
  }
  check(
    await table.upsert(
      {
        person_id: key.personId,
        category_id: key.categoryId,
        month_start: key.monthStart,
        target_amount: amount,
        currency,
      },
      { onConflict: "person_id,category_id,month_start" },
    ),
  );
}
