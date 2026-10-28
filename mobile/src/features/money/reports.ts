import {
  isoDay,
  normalizeSpendingReport,
  type SpendingPeriod,
  type SpendingReport,
} from "@orbit-types/money-spending-report";
import { supabase } from "@/lib/supabase";

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The spending report for a period, in `currency`, optionally narrowed to some accounts and to a
 * category's branch. As on the web, the period's exchange rates are brought up to date first; a
 * period still ahead needs none.
 */
export async function fetchSpendingReport(query: SpendingReportQuery): Promise<SpendingReport> {
  const today = isoDay(new Date());
  const end = query.period.end < today ? query.period.end : today;
  const start = query.period.start;
  if (start <= end) {
    check(
      await supabase.functions.invoke("money-fx-sync", {
        body: {
          start_date: start,
          end_date: end,
          base_currency: "USD",
          quote_currencies: ["RUB"],
        },
      }),
    );
  }
  const data = check(
    await supabase.rpc("money_get_spending_report", {
      p_person_id: query.personId,
      p_start: query.period.start,
      p_end: query.period.end,
      p_report_currency: query.currency,
      p_account_ids: query.accountIds.length ? query.accountIds : null,
      p_category_id: query.categoryId,
    } as never),
  ) as unknown;
  return normalizeSpendingReport(data);
}

export interface SpendingReportQuery {
  personId: string;
  period: SpendingPeriod;
  currency: string;
  accountIds: string[];
  categoryId: string | null;
}

export interface SelfAlias {
  id: string;
  alias: string;
  normalized_alias: string | null;
}

/** The names a person's own transfers go by, so the report leaves them out. */
export async function fetchSelfAliases(personId: string): Promise<SelfAlias[]> {
  const rows = check(
    await supabase
      .from("money_transfer_self_aliases")
      .select("id, alias, normalized_alias")
      .eq("person_id", personId)
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []) as SelfAlias[];
}

/** Add an alias (its normalised form is the database's to fill), or delete one by `id`. */
export async function saveSelfAlias(
  change: { personId: string; alias: string } | { id: string },
): Promise<void> {
  const table = supabase.from("money_transfer_self_aliases");
  if ("id" in change) check(await table.delete().eq("id", change.id));
  else check(await table.insert({ person_id: change.personId, alias: change.alias } as never));
}
