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

/**
 * `day + every unit`, as PostgreSQL adds an interval to a date: weeks are exact, and months and
 * years keep the day of the month, clamped to the target month's last day (2027-01-31 plus a month
 * is 2027-02-28, not 2027-03-03 as `Date` overflow would make it). A negative `every` goes back.
 */
export function addInterval(day: string, every: number, unit: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (unit === "week") {
    return new Date(Date.UTC(year, month - 1, date + 7 * every)).toISOString().slice(0, 10);
  }
  const months = year * 12 + (month - 1) + (unit === "month" ? every : 12 * every);
  const targetYear = Math.floor(months / 12);
  const targetMonth = months - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/**
 * Where an interval series is anchored so it first falls due on `firstDue`.
 *
 * `checkup_item_set_next_due_on_insert` sets the first due date to the anchor plus one interval:
 * the anchor is when the series counts from, as a completion is. Anchoring on the due date itself
 * would schedule it a whole interval late.
 */
export function anchorFor(
  schedule: Extract<ProposedCheckup["schedule"], { type: "interval" }>,
  firstDue: string,
): string {
  return addInterval(firstDue, -schedule.every, schedule.unit);
}

/**
 * The first due date the insert trigger will set: a one-off's own date; for an interval, one
 * interval after its anchor, which is today when none was asked for. Computed the way the database
 * computes it, so at a month's end it can be a day or three before the date asked for, and the card
 * shows the date that will actually be stored.
 */
export function firstDueDate(
  schedule: ProposedCheckup["schedule"],
  requested: string | null | undefined,
  today: string,
): string {
  if (schedule.type === "one_off") return schedule.due_at;
  const anchor = requested ? anchorFor(schedule, requested) : today;
  return addInterval(anchor, schedule.every, schedule.unit);
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

export interface AddProposedCheckupsOptions {
  /**
   * Owner notes for a single-item create draft. When set (including empty → null),
   * written on the insert; when omitted, the usual Claude attribution string is used.
   */
  notes?: string | null;
  /**
   * Reminder lead days for a single-item create draft. When set (including `[]`),
   * written on the insert so confirm does not need a post-insert update.
   */
  reminder_days_before?: number[];
}

/** Write the checkups the owner added from the card; `next_due_at` is the insert trigger's. */
export async function addProposedCheckups(
  supabase: SupabaseClient<Database>,
  personId: string,
  review: CheckupProposalReview,
  options?: AddProposedCheckupsOptions,
): Promise<Array<{ id: string; title: string; next_due_at: string | null }>> {
  if (review.accepted.length === 0) return [];
  const source = review.evidence
    ? `Добавлено из Claude по записи «${review.evidence.title}»${review.evidence.record_date ? ` от ${review.evidence.record_date}` : ""}.`
    : "Добавлено из Claude.";
  const ownerNotes = options?.notes?.trim() ? options.notes.trim() : null;
  const rows = review.accepted.map(({ input, condition_name }) => ({
    person_id: personId,
    title: input.title.trim(),
    category: input.category,
    schedule:
      input.schedule.type === "interval" && input.first_due_at
        ? { ...input.schedule, anchor_date: anchorFor(input.schedule, input.first_due_at) }
        : input.schedule,
    why_text: input.why.trim() || null,
    why_links:
      input.condition_id && condition_name
        ? [{ type: "condition", id: input.condition_id, label: condition_name }]
        : [],
    notes: ownerNotes ?? source,
    ...(options?.reminder_days_before !== undefined
      ? { reminder_days_before: options.reminder_days_before }
      : {}),
  }));
  const { data, error } = await supabase
    .from("checkup_items")
    .insert(rows as never)
    .select("id, title, next_due_at");
  if (error) throw new Error(`Failed to add the checkups: ${error.message}`);
  return (data ?? []) as Array<{ id: string; title: string; next_due_at: string | null }>;
}

/** Schedule shape an agent can set on an existing checkup (same union as propose, plus next_due_from). */
export type CheckupScheduleWrite =
  | {
      type: "interval";
      every: number;
      unit: "week" | "month" | "year";
      first_due_at?: string | null;
      next_due_from?: "completion" | "target";
    }
  | { type: "one_off"; due_at: string };

export interface CheckupItemSnapshot {
  id: string;
  person_id: string;
  title: string;
  category: string;
  status: string;
  schedule: unknown;
  next_due_at: string | null;
  planned_on: string | null;
  reminder_days_before: number[] | null;
}

function toDateOnly(day: string | undefined | null, fallback: string): string {
  if (day && day.trim().length > 0) return day.trim().slice(0, 10);
  return fallback;
}

/**
 * Build the jsonb `schedule` column from an agent write.
 * When `first_due_at` is omitted on an interval, keep the existing anchor (and
 * `next_due_from` unless the write sets one) so a frequency-only edit does not
 * drop the series' place in the calendar.
 */
export function scheduleColumnFromWrite(
  input: CheckupScheduleWrite,
  existingSchedule?: unknown,
): Record<string, unknown> {
  if (input.type === "one_off") {
    return { type: "one_off", due_at: input.due_at };
  }
  const previous =
    existingSchedule && typeof existingSchedule === "object"
      ? (existingSchedule as Record<string, unknown>)
      : null;
  const schedule: Record<string, unknown> = {
    type: "interval",
    every: input.every,
    unit: input.unit,
  };
  if (input.next_due_from) {
    schedule.next_due_from = input.next_due_from;
  } else if (typeof previous?.next_due_from === "string") {
    schedule.next_due_from = previous.next_due_from;
  }
  if (input.first_due_at) {
    schedule.anchor_date = anchorFor(
      { type: "interval", every: input.every, unit: input.unit },
      input.first_due_at,
    );
  } else if (typeof previous?.anchor_date === "string" && previous.anchor_date.length > 0) {
    schedule.anchor_date = previous.anchor_date;
  }
  return schedule;
}

/** `null` clears reminders to `[]` — the column is NOT NULL. */
export function normalizeReminderDays(days: number[] | null | undefined): number[] | undefined {
  if (days === undefined) return undefined;
  if (days === null) return [];
  return [...days].filter((day) => Number.isFinite(day) && day >= 0).sort((a, b) => b - a);
}

export async function latestCompletionDay(
  supabase: SupabaseClient<Database>,
  checkupId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("checkup_completions")
    .select("done_at")
    .eq("checkup_item_id", checkupId)
    .order("done_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load checkup completions: ${error.message}`);
  const doneAt = (data as { done_at?: string } | null)?.done_at;
  return doneAt ? String(doneAt).slice(0, 10) : null;
}

export async function completionCount(
  supabase: SupabaseClient<Database>,
  checkupId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("checkup_completions")
    .select("id", { count: "exact", head: true })
    .eq("checkup_item_id", checkupId);
  if (error) throw new Error(`Failed to count checkup completions: ${error.message}`);
  return count ?? 0;
}

export async function loadCheckupItem(
  supabase: SupabaseClient<Database>,
  checkupId: string,
): Promise<CheckupItemSnapshot | null> {
  const { data, error } = await supabase
    .from("checkup_items")
    .select(
      "id, person_id, title, category, status, schedule, next_due_at, planned_on, reminder_days_before",
    )
    .eq("id", checkupId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load checkup: ${error.message}`);
  return (data as CheckupItemSnapshot | null) ?? null;
}

async function setCheckupPlannedOn(
  supabase: SupabaseClient<Database>,
  checkupId: string,
  plannedOn: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("checkup_items")
    .update({ planned_on: plannedOn })
    .eq("id", checkupId);
  if (error) {
    throw new Error(`Failed to update planned_on: ${error.message}`);
  }
}

/**
 * Record that a checkup was done on `doneAt` (YYYY-MM-DD). Database triggers advance
 * `next_due_at` (or complete a one-off). Refuses archived items and evidence that is not the
 * person's.
 */
export async function markCheckupDone(
  supabase: SupabaseClient<Database>,
  params: {
    checkupId: string;
    doneAt: string;
    note?: string | null;
    evidenceRecordId?: string | null;
  },
): Promise<{
  checkup: CheckupItemSnapshot;
  completion: {
    id: string;
    done_at: string;
    note: string | null;
    evidence_record_id: string | null;
  };
}> {
  const checkup = await loadCheckupItem(supabase, params.checkupId);
  if (!checkup) {
    throw new Error(`No checkup with id ${params.checkupId}.`);
  }
  if (checkup.status === "archived") {
    throw new Error(
      `Checkup "${checkup.title}" is archived; restore it in the app before marking it done.`,
    );
  }

  if (params.evidenceRecordId) {
    const { data: evidence, error: evidenceError } = await supabase
      .from("medical_records")
      .select("id")
      .eq("id", params.evidenceRecordId)
      .eq("person_id", checkup.person_id)
      .maybeSingle();
    if (evidenceError) throw new Error(`Failed to check evidence record: ${evidenceError.message}`);
    if (!evidence) {
      throw new Error("evidence_record_id is not one of this person's records");
    }
  }

  const doneAt = toDateOnly(params.doneAt, new Date().toISOString().slice(0, 10));
  // Insert trigger advances next_due from NEW.done_at, not from the latest completion in
  // history — a backdate older than the last done day would pull the cycle backwards.
  const latestDone = await latestCompletionDay(supabase, checkup.id);
  if (latestDone && doneAt < latestDone) {
    throw new Error(
      `done_at ${doneAt} is before the latest completion on ${latestDone}. ` +
        `Logging an older completion would move next_due_at backwards; omit done_at or use a day on or after ${latestDone}.`,
    );
  }

  // Same order as mobile completeCheckup: clear the plan first, then insert. If the insert
  // fails, restore the plan — never leave a landed completion behind a retryable failure
  // (a second insert would advance a target-based due date another interval).
  const priorPlannedOn = checkup.planned_on;
  if (priorPlannedOn) {
    await setCheckupPlannedOn(supabase, checkup.id, null);
  }

  const { data: completion, error } = await supabase
    .from("checkup_completions")
    .insert({
      checkup_item_id: checkup.id,
      done_at: doneAt,
      note: params.note?.trim() ? params.note.trim() : null,
      evidence_record_id: params.evidenceRecordId ?? null,
    })
    .select("id, done_at, note, evidence_record_id")
    .single();
  if (error || !completion) {
    if (priorPlannedOn) {
      await setCheckupPlannedOn(supabase, checkup.id, priorPlannedOn).catch(() => undefined);
    }
    throw new Error(`Failed to mark checkup done: ${error?.message ?? "no row returned"}`);
  }

  const refreshed = (await loadCheckupItem(supabase, checkup.id)) ?? checkup;
  return {
    checkup: refreshed,
    completion: completion as {
      id: string;
      done_at: string;
      note: string | null;
      evidence_record_id: string | null;
    },
  };
}

/**
 * Replace a checkup's schedule (and optionally its reminder lead times). Triggers recompute
 * `next_due_at`. Refuses archived items.
 */
export async function updateCheckupSchedule(
  supabase: SupabaseClient<Database>,
  params: {
    checkupId: string;
    schedule: CheckupScheduleWrite;
    reminderDaysBefore?: number[] | null;
  },
): Promise<{ before: CheckupItemSnapshot; after: CheckupItemSnapshot }> {
  const before = await loadCheckupItem(supabase, params.checkupId);
  if (!before) {
    throw new Error(`No checkup with id ${params.checkupId}.`);
  }
  if (before.status === "archived") {
    throw new Error(
      `Checkup "${before.title}" is archived; restore it in the app before editing its schedule.`,
    );
  }

  if (params.schedule.type === "interval" && params.schedule.first_due_at) {
    const priorCompletions = await completionCount(supabase, before.id);
    if (priorCompletions > 0) {
      throw new Error(
        `first_due_at cannot retarget the next due date after ${priorCompletions} completion(s) are logged; ` +
          `the database advances from the latest completion. Omit first_due_at to change the interval only, ` +
          `or set next_due_from="target" and keep the existing anchor.`,
      );
    }
  }

  const payload: Record<string, unknown> = {
    schedule: scheduleColumnFromWrite(params.schedule, before.schedule),
  };
  const reminders = normalizeReminderDays(params.reminderDaysBefore);
  if (reminders !== undefined) {
    payload.reminder_days_before = reminders;
  }
  // Interval recompute only writes next_due_at — a completed one-off would stay completed
  // and stop getting reminders / advancing on later completions. Reactivate on conversion.
  if (params.schedule.type === "interval" && before.status === "completed") {
    payload.status = "active";
  }

  const { error } = await supabase
    .from("checkup_items")
    .update(payload as never)
    .eq("id", before.id);
  if (error) {
    throw new Error(`Failed to update checkup schedule: ${error.message}`);
  }
  // AFTER UPDATE trigger recomputes next_due_at / one-off status in a separate write;
  // the UPDATE's RETURNING row would still show the pre-trigger values.
  const after = await loadCheckupItem(supabase, before.id);
  if (!after) {
    throw new Error(`Failed to reload checkup ${before.id} after schedule update.`);
  }
  return { before, after };
}
