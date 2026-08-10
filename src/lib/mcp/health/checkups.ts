import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Checkups: recurring or one-off screening reminders, plus the log of times
 * each was completed.
 *
 * `next_due_at` is maintained by database triggers when a completion is
 * recorded, so nothing here recomputes it.
 */

export interface CheckupRow {
  id: string;
  person_id: string;
  title: string;
  category: string;
  schedule: unknown;
  next_due_at: string | null;
  status: string;
  why_text: string | null;
  notes: string | null;
  planned_on: string | null;
  reminder_days_before: number[] | null;
  is_overdue: boolean;
  days_until_due: number | null;
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

export type CheckupDueWindow = "overdue" | "upcoming" | "all";

export async function listCheckups(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    category?: string;
    status?: string;
    dueWindow?: CheckupDueWindow;
    dueBefore?: string;
    now?: Date;
  },
): Promise<CheckupRow[]> {
  let query = supabase
    .from("checkup_items")
    .select(
      "id, person_id, title, category, schedule, next_due_at, status, why_text, notes, planned_on, reminder_days_before",
    )
    .eq("person_id", params.personId)
    .order("next_due_at", { ascending: true, nullsFirst: false });

  // Casts: these are validated against the enum by the tool's zod schema before
  // reaching here, but the generated types want the literal union.
  if (params.category) query = query.eq("category", params.category as never);
  if (params.status) query = query.eq("status", params.status as never);
  if (params.dueBefore) query = query.lte("next_due_at", params.dueBefore);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load checkups: ${error.message}`);
  }

  const now = params.now ?? new Date();

  const rows = (
    (data ?? []) as unknown as Array<Omit<CheckupRow, "is_overdue" | "days_until_due">>
  ).map((row) => {
    const daysUntil = row.next_due_at ? daysBetween(now, new Date(row.next_due_at)) : null;
    return {
      ...row,
      days_until_due: daysUntil,
      // Only an active checkup can be overdue; paused and archived ones are
      // not something the user is expected to act on.
      is_overdue: row.status === "active" && daysUntil !== null && daysUntil < 0,
    };
  });

  switch (params.dueWindow) {
    case "overdue":
      return rows.filter((row) => row.is_overdue);
    case "upcoming":
      return rows.filter(
        (row) => row.status === "active" && row.days_until_due !== null && row.days_until_due >= 0,
      );
    default:
      return rows;
  }
}

export async function getCheckup(
  supabase: SupabaseClient<Database>,
  checkupId: string,
): Promise<{
  checkup: Record<string, unknown> | null;
  completions: Array<Record<string, unknown>>;
}> {
  const { data: checkup, error } = await supabase
    .from("checkup_items")
    .select("*")
    .eq("id", checkupId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load checkup: ${error.message}`);
  }

  if (!checkup) {
    return { checkup: null, completions: [] };
  }

  const { data: completions } = await supabase
    .from("checkup_completions")
    .select("id, done_at, note, evidence_record_id, created_at")
    .eq("checkup_item_id", checkupId)
    .order("done_at", { ascending: false });

  return {
    checkup: checkup as unknown as Record<string, unknown>,
    completions: (completions ?? []) as unknown as Array<Record<string, unknown>>,
  };
}
