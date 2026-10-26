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

/** A new checkup as `propose_checkup` describes it, and as the card hands it back on Add. */
export interface ProposedCheckup {
  title: string;
  category: "lab" | "imaging" | "visit" | "vaccination" | "dental" | "other";
  schedule:
    | { type: "interval"; every: number; unit: "week" | "month" | "year" }
    | { type: "one_off"; due_at: string };
  /** For an interval: the first due date; without it the first is one interval from today. */
  first_due_at?: string | null;
  why: string;
  condition_id?: string | null;
}

export interface ReviewedCheckup {
  input: ProposedCheckup;
  /** When it first falls due, as the insert trigger will set `next_due_at`. */
  first_due_at: string;
  condition_name: string | null;
}

export interface CheckupProposalReview {
  accepted: ReviewedCheckup[];
  refused: Array<{ title: string; reason: string }>;
  evidence: { record_id: string; title: string; record_date: string | null } | null;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function addInterval(day: string, every: number, unit: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (unit === "week") date.setUTCDate(date.getUTCDate() + 7 * every);
  else if (unit === "month") date.setUTCMonth(date.getUTCMonth() + every);
  else date.setUTCFullYear(date.getUTCFullYear() + every);
  return date.toISOString().slice(0, 10);
}

/**
 * The first due date `checkup_item_set_next_due_on_insert` will give an interval checkup: its
 * anchor when that is today or later, else the first date of the series that is; one interval from
 * today without an anchor.
 */
export function firstDueDate(
  schedule: ProposedCheckup["schedule"],
  anchor: string | null | undefined,
  today: string,
): string {
  if (schedule.type === "one_off") return schedule.due_at;
  if (!anchor) return addInterval(today, schedule.every, schedule.unit);
  let due = anchor;
  while (due < today) due = addInterval(due, schedule.every, schedule.unit);
  return due;
}

/**
 * Check new checkups proposed for a person (T-261026-y7c): refuse one the person already has under
 * the same title (active or paused), one repeated in the batch, and one citing a condition or
 * record that is not theirs. Nothing is written; `propose_checkup` shows what passes on a card, and
 * the owner's Add runs this again before `addProposedCheckups` writes it.
 */
export async function reviewCheckupProposals(
  supabase: SupabaseClient<Database>,
  personId: string,
  items: ProposedCheckup[],
  evidenceRecordId: string | null,
  today: string,
): Promise<CheckupProposalReview> {
  const conditionIds = items.flatMap((item) => (item.condition_id ? [item.condition_id] : []));
  const [existing, conditions, record] = await Promise.all([
    supabase
      .from("checkup_items")
      .select("title, status")
      .eq("person_id", personId)
      .in("status", ["active", "paused"]),
    conditionIds.length > 0
      ? supabase
          .from("conditions")
          .select("id, name")
          .eq("person_id", personId)
          .is("deleted_at", null)
          .in("id", conditionIds)
      : Promise.resolve({ data: [], error: null }),
    evidenceRecordId
      ? supabase
          .from("medical_records")
          .select("id, title, record_date")
          .eq("person_id", personId)
          .eq("id", evidenceRecordId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [existing, conditions, record]) {
    if (result.error) throw new Error(`Failed to check the proposal: ${result.error.message}`);
  }

  const taken = new Map(
    ((existing.data ?? []) as Array<{ title: string; status: string }>).map((row) => [
      normalizeTitle(row.title),
      row,
    ]),
  );
  const conditionNames = new Map(
    ((conditions.data ?? []) as Array<{ id: string; name: string }>).map((row) => [
      row.id,
      row.name,
    ]),
  );
  const evidence = record.data as { id: string; title: string; record_date: string | null } | null;

  const accepted: ReviewedCheckup[] = [];
  const refused: CheckupProposalReview["refused"] = [];
  if (evidenceRecordId && !evidence) {
    return {
      accepted,
      refused: items.map((item) => ({
        title: item.title,
        reason: "evidence_record_id is not one of this person's records",
      })),
      evidence: null,
    };
  }
  for (const item of items) {
    const key = normalizeTitle(item.title);
    const clash = taken.get(key);
    if (clash) {
      refused.push({
        title: item.title,
        reason: `already scheduled as "${clash.title}" (${clash.status}); complete or edit that one instead`,
      });
      continue;
    }
    if (item.condition_id && !conditionNames.has(item.condition_id)) {
      refused.push({
        title: item.title,
        reason: "condition_id is not one of this person's conditions",
      });
      continue;
    }
    taken.set(key, { title: item.title, status: "proposed in this call" });
    accepted.push({
      input: item,
      first_due_at: firstDueDate(item.schedule, item.first_due_at, today),
      condition_name: item.condition_id ? (conditionNames.get(item.condition_id) ?? null) : null,
    });
  }
  return {
    accepted,
    refused,
    evidence: evidence
      ? { record_id: evidence.id, title: evidence.title, record_date: evidence.record_date }
      : null,
  };
}

/** Write the checkups the owner added from the card; `next_due_at` is the insert trigger's. */
export async function addProposedCheckups(
  supabase: SupabaseClient<Database>,
  personId: string,
  review: CheckupProposalReview,
): Promise<Array<{ id: string; title: string; next_due_at: string | null }>> {
  if (review.accepted.length === 0) return [];
  const source = review.evidence
    ? `Добавлено из Claude по записи «${review.evidence.title}»${review.evidence.record_date ? ` от ${review.evidence.record_date}` : ""}.`
    : "Добавлено из Claude.";
  const rows = review.accepted.map(({ input, condition_name }) => ({
    person_id: personId,
    title: input.title.trim(),
    category: input.category,
    schedule:
      input.schedule.type === "interval" && input.first_due_at
        ? { ...input.schedule, anchor_date: input.first_due_at }
        : input.schedule,
    why_text: input.why.trim() || null,
    why_links:
      input.condition_id && condition_name
        ? [{ type: "condition", id: input.condition_id, label: condition_name }]
        : [],
    notes: source,
  }));
  const { data, error } = await supabase
    .from("checkup_items")
    .insert(rows as never)
    .select("id, title, next_due_at");
  if (error) throw new Error(`Failed to add the checkups: ${error.message}`);
  return (data ?? []) as Array<{ id: string; title: string; next_due_at: string | null }>;
}
