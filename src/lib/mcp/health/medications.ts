import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { rowToDoseEvent, rowToInventoryTransaction, rowToRegimen } from "@/lib/regimen-mappers";
import { getEffectiveStatus, getPlannedIntakeAmount, type PlannedIntake } from "@/types/regimen";
import type { MedDoseEvent, MedRegimen, MedSchedule } from "@/types/regimen";

/**
 * Medications.
 *
 * The live model is `med_regimens` (the prescription: what, how much, how
 * often) plus `med_dose_events` (the generated individual intakes) and
 * `med_inventory_transactions` (stock on hand). The older `medications` table
 * is dead and must not be used.
 *
 * Regimens are soft-deleted via `deleted_at`.
 */

export interface RegimenWithStatus extends MedRegimen {
  effective_status: string;
}

/**
 * `getEffectiveStatus` accounts for a regimen whose end date has passed but
 * whose stored status still says "active"; the UI shows it as completed, and so
 * should we.
 */
function withEffectiveStatus(regimen: MedRegimen): RegimenWithStatus {
  return { ...regimen, effective_status: getEffectiveStatus(regimen) };
}

/**
 * Escapes every POSIX regex metacharacter, so a name is matched literally.
 *
 * The filter this replaced was a case-insensitive `String.includes`, and the
 * search text is whatever the user said -- a name can legitimately contain `%`,
 * `*`, `+` or a bracket. `ilike` was the obvious operator and the wrong one:
 * PostgREST reads `*` in a `like`/`ilike` value as `%`, unconditionally and
 * with no escape that survives the substitution, so `B*Complex` would silently
 * widen into a wildcard search and inflate the count beside it.
 */
function regexLiteral(value: string): string {
  return value.replace(/[.^$*+?()[\]{}|\\]/g, (match) => `\\${match}`);
}

/**
 * One page of a person's regimens, with the total that matched.
 *
 * The name filter runs in the query rather than over the result: PostgREST caps
 * a response at `max_rows` (1000 in `supabase/config.toml`), and filtering
 * afterwards would page rows the database had already truncated -- so a person
 * with a long history would find their oldest courses unreachable while the
 * reply claimed there was nothing more.
 */
export async function listMedications(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    status?: string;
    search?: string;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<{ regimens: RegimenWithStatus[]; total: number }> {
  let query = supabase
    .from("med_regimens")
    .select("*", { count: "exact" })
    .eq("person_id", params.personId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    // `created_at` is not unique -- four courses of one medication were created
    // in the same minute in production -- and an unstable order under paging
    // repeats one row while dropping another.
    .order("id", { ascending: true });

  if (params.status) {
    query = query.eq("status", params.status as never);
  } else if (!params.includeArchived) {
    query = query.neq("status", "archived");
  }

  const needle = params.search?.trim();
  if (needle) {
    // `imatch` is `~*`: a case-insensitive regex, with no wildcard aliasing of
    // its own, so an escaped needle means exactly "contains this text".
    query = query.regexIMatch("custom_name", regexLiteral(needle));
  }

  if (params.limit != null) {
    const offset = params.offset ?? 0;
    query = query.range(offset, offset + params.limit - 1);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to load medications: ${error.message}`);
  }

  const regimens = ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .map(rowToRegimen)
    .map(withEffectiveStatus);

  return { regimens, total: count ?? regimens.length };
}

/** How many of the newest stock movements `getMedication` returns. */
export const INVENTORY_LIMIT = 20;

/**
 * Doses fetched either side of now for the detail tool.
 *
 * The text renders ten a side; the rest ride along in `structuredContent` for a
 * client that wants them, and the exact totals say how many were left in the
 * database either way.
 */
export const DETAIL_DOSE_FETCH = 50;

export async function getMedication(
  supabase: SupabaseClient<Database>,
  params: {
    regimenId: string;
    horizonDays: number;
    inventoryLimit?: number;
    inventoryOffset?: number;
  },
): Promise<{
  regimen: RegimenWithStatus | null;
  upcomingDoses: MedDoseEvent[];
  recentDoses: MedDoseEvent[];
  /** How many doses the horizon holds either side of now, of which the nearest are returned. */
  upcomingTotal: number;
  recentTotal: number;
  inventoryTransactions: ReturnType<typeof rowToInventoryTransaction>[];
  /** How many movements the ledger holds, of which the newest are returned. */
  inventoryTotal: number;
} | null> {
  const { data, error } = await supabase
    .from("med_regimens")
    .select("*")
    .eq("id", params.regimenId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load medication: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const regimen = withEffectiveStatus(rowToRegimen(data as unknown as Record<string, unknown>));

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + params.horizonDays * 86_400_000);
  const recentStart = new Date(now.getTime() - params.horizonDays * 86_400_000);

  // Two queries, each counted and bounded, rather than one unbounded window
  // split in memory. PostgREST caps a response at `max_rows` (1000), and an
  // hourly course over a 30-day horizon has ~1440 events either side: a single
  // ascending query would have been cut at the cap, reporting the truncation as
  // the count and losing the upcoming tail entirely -- the same defect the two
  // listings were fixed for.
  //
  // `actual_at`, not `scheduled_at`: `snooze_dose.sql` moves the first and
  // leaves the second, and the effective time is what the reminder query fires
  // on, what the dashboard sorts by and what these tools print. A dose snoozed
  // across midnight belongs to the day it is now due on, and one snoozed past
  // now is still upcoming.
  const nowIso = now.toISOString();
  const dosePage = (order: "recent" | "upcoming") => {
    const query = supabase
      .from("med_dose_events")
      .select("*", { count: "exact" })
      .eq("regimen_id", params.regimenId)
      .is("deleted_at", null);
    return order === "recent"
      ? query
          .gte("actual_at", recentStart.toISOString())
          .lt("actual_at", nowIso)
          // Newest first, so the page holds the intakes nearest now rather than
          // the oldest in the window.
          .order("actual_at", { ascending: false })
          .order("id", { ascending: true })
          .range(0, DETAIL_DOSE_FETCH - 1)
      : query
          .gte("actual_at", nowIso)
          .lte("actual_at", horizonEnd.toISOString())
          .order("actual_at", { ascending: true })
          .order("id", { ascending: true })
          .range(0, DETAIL_DOSE_FETCH - 1);
  };

  const [recent, upcoming] = await Promise.all([dosePage("recent"), dosePage("upcoming")]);

  const toDoses = (rows: unknown) =>
    ((rows ?? []) as unknown as Array<Record<string, unknown>>).map(rowToDoseEvent);
  // Back to ascending, which is the order the renderer and the payload expect.
  const recentDoses = toDoses(recent.data).reverse();
  const upcomingDoses = toDoses(upcoming.data);

  // Counted as well as capped: a caller told only "here are 20 movements"
  // cannot tell a complete ledger from a truncated one, and stock questions are
  // exactly where that matters.
  const { data: transactions, count: inventoryTotal } = await supabase
    .from("med_inventory_transactions")
    .select("*", { count: "exact" })
    .eq("regimen_id", params.regimenId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(
      params.inventoryOffset ?? 0,
      (params.inventoryOffset ?? 0) + (params.inventoryLimit ?? INVENTORY_LIMIT) - 1,
    );

  return {
    regimen,
    upcomingDoses,
    recentDoses,
    upcomingTotal: upcoming.count ?? upcomingDoses.length,
    recentTotal: recent.count ?? recentDoses.length,
    inventoryTransactions: ((transactions ?? []) as unknown as Array<Record<string, unknown>>).map(
      rowToInventoryTransaction,
    ),
    inventoryTotal: inventoryTotal ?? (transactions ?? []).length,
  };
}

/**
 * One page of intakes, with the total the range actually holds.
 *
 * The count comes from the database rather than the length of what was
 * returned: PostgREST caps a response at `max_rows` (1000 in
 * `supabase/config.toml`), so a wide range would otherwise report its own
 * truncation as the total and declare there was nothing more to fetch.
 */
export async function listMedicationDoses(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    from: string;
    to: string;
    status?: string;
    regimenId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{
  doses: Array<
    MedDoseEvent & {
      medication_name: string | null;
      medication_dose: PlannedIntake | null;
      medication_schedule: MedSchedule | null;
    }
  >;
  total: number;
}> {
  let query = supabase
    .from("med_dose_events")
    // The course's own `dose_definition` rides along because an intake's
    // milligrams are only meaningful beside the amount they were recorded for:
    // nothing scales `active` when a slot or a correction changes the amount,
    // so the renderer has to be able to say which amount the strength belongs
    // to rather than implying it belongs to this one. The `schedule` comes with
    // it because a per-slot amount is the other way an event's amount can
    // differ from the definition the strength was recorded against.
    .select("*, regimen:med_regimens ( custom_name, dose_definition, schedule )", {
      count: "exact",
    })
    .eq("person_id", params.personId)
    .is("deleted_at", null)
    // Ranged and ordered by the effective time for the same reason the detail
    // tool is: a dose snoozed to the next day is asked about, and answered for,
    // the day it is actually due.
    .gte("actual_at", params.from)
    .lte("actual_at", params.to)
    .order("actual_at", { ascending: true })
    // Several medications commonly fall on the same minute, and ordering by a
    // non-unique column alone lets successive pages return one of those rows
    // twice and skip another.
    .order("id", { ascending: true });

  if (params.status) {
    query = query.eq("status", params.status as never);
  }

  // Filtered in the query rather than by the caller: "when did this one course
  // change dose" is the question that otherwise costs a scan of every
  // medication in the window, which is how a titration history came to be
  // reconstructed by binary search over 3-5 day ranges.
  if (params.regimenId) {
    query = query.eq("regimen_id", params.regimenId);
  }

  // Paged in the query, so the window is bounded by the database rather than
  // sliced out of a response that may already be truncated.
  if (params.limit != null) {
    const offset = params.offset ?? 0;
    query = query.range(offset, offset + params.limit - 1);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to load medication intakes: ${error.message}`);
  }

  const doses = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    ...rowToDoseEvent(row),
    medication_name: (row.regimen as { custom_name?: string } | null)?.custom_name ?? null,
    medication_dose:
      ((row.regimen as { dose_definition?: PlannedIntake } | null)?.dose_definition as
        | PlannedIntake
        | undefined) ?? null,
    medication_schedule:
      ((row.regimen as { schedule?: MedSchedule } | null)?.schedule as MedSchedule | undefined) ??
      null,
  }));

  return { doses, total: count ?? doses.length };
}

export async function createRegimen(
  supabase: SupabaseClient<Database>,
  values: Record<string, unknown>,
): Promise<RegimenWithStatus> {
  const { data, error } = await supabase
    .from("med_regimens")
    .insert(values as never)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create medication: ${error?.message ?? "no row returned"}`);
  }
  return withEffectiveStatus(rowToRegimen(data as unknown as Record<string, unknown>));
}

export async function updateRegimen(
  supabase: SupabaseClient<Database>,
  regimenId: string,
  values: Record<string, unknown>,
): Promise<RegimenWithStatus> {
  const { data, error } = await supabase
    .from("med_regimens")
    .update(values as never)
    .eq("id", regimenId)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update medication: ${error.message}`);
  }
  if (!data) {
    throw new Error(`No medication with id ${regimenId}.`);
  }
  return withEffectiveStatus(rowToRegimen(data as unknown as Record<string, unknown>));
}

/**
 * The medication form's matcher, in one place.
 *
 * `medication-form.tsx` decides whether a one-time intake belongs to an
 * existing course by comparing trimmed, lower-cased names. Anything looser
 * (substring, edit distance) would fuse "Магний" with "Магний B6", which are
 * different medications.
 */
export function normalizeMedicationName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Every non-deleted course the person already has under this name, archived and
 * completed ones included -- the same pool the form's name combobox offers,
 * because a dose can legitimately be logged against a course that has ended.
 */
export async function findRegimensByName(
  supabase: SupabaseClient<Database>,
  params: { personId: string; name: string },
): Promise<RegimenWithStatus[]> {
  const needle = normalizeMedicationName(params.name);
  if (!needle) {
    return [];
  }

  const { regimens } = await listMedications(supabase, {
    personId: params.personId,
    includeArchived: true,
    search: needle,
  });

  return regimens.filter((regimen) => normalizeMedicationName(regimen.custom_name) === needle);
}

export interface LogDoseParams {
  regimenId: string;
  at: string;
  amount?: number | null;
  status: "taken" | "skipped";
  note?: string | null;
}

/**
 * The dose the caller describes may already exist.
 *
 * Deliberately unfiltered by status. It is tempting to look only for the
 * unresolved statuses `idx_med_dose_events_regimen_scheduled_minute` covers,
 * but that index answers "may another unresolved row go here", not "is this
 * intake already recorded". A dose the person ticked in the app minutes ago is
 * `taken`: invisible to a status-filtered probe *and* unblocked by the index,
 * so logging it again would write a second intake at the same minute and
 * decrement stock twice. `snoozed` is the same, and additionally leaves its
 * `medication_snoozed` digest armed, reminding the person about a dose already
 * recorded.
 *
 * Every status the RPCs accept is handled by resolving this row rather than
 * inserting beside it -- `mark_dose_taken` takes `skipped` and
 * `mark_dose_skipped` takes `taken`, precisely so a resolution can be amended
 * in place.
 */
async function findDoseInSameMinute(
  supabase: SupabaseClient<Database>,
  regimenId: string,
  at: Date,
  requestedStatus?: string,
): Promise<Record<string, unknown> | null> {
  const minuteStart = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  const minuteEnd = new Date(minuteStart.getTime() + 60_000);

  const from = minuteStart.toISOString();
  const to = minuteEnd.toISOString();

  // Either timestamp, because the caller may name either one. `scheduled_at` is
  // the planned slot an off-plan intake attaches to; `actual_at` is where a
  // snooze moved that slot to, and it is the time the read tools print, the app
  // shows and the reminder fires on. Matching only the planned time meant a
  // caller logging the 11:00 dose they had just been shown -- snoozed there
  // from 09:00 -- inserted a second event, decremented stock for it, and left
  // the snoozed reminder unresolved.
  const { data, error } = await supabase
    .from("med_dose_events")
    .select("*")
    .eq("regimen_id", regimenId)
    .is("deleted_at", null)
    .or(
      `and(scheduled_at.gte.${from},scheduled_at.lt.${to}),and(actual_at.gte.${from},actual_at.lt.${to})`,
    )
    .order("created_at", { ascending: true })
    // More than two rows can share a minute: the unique index bounds only the
    // unresolved ones, and a snooze can move a dose onto a minute that already
    // holds a resolved intake.
    .limit(10);

  // This read decides between resolving and inserting, so "the query failed"
  // must not be read as "nothing is there": that would take the insert branch
  // and trip the unique index, or worse, duplicate a resolved intake.
  if (error) {
    throw new Error(`Failed to look for an existing dose at that time: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const byEffectiveTime = (row: Record<string, unknown>) =>
    typeof row.actual_at === "string" && row.actual_at >= from && row.actual_at < to;
  // A row already in the requested status has nothing left to do, so choosing
  // it would answer "already recorded" while a second dose on the same minute
  // -- which `snooze_dose` allows -- stays unresolved, its reminder armed and
  // its stock movement unwritten. The dose that still needs the transition
  // comes first; only when none does is the call genuinely a repeat.
  const needsTransition = (row: Record<string, unknown>) =>
    requestedStatus == null || row.status !== requestedStatus;
  const ranked = [...rows].sort((a, b) => {
    const byWork = Number(needsTransition(b)) - Number(needsTransition(a));
    if (byWork !== 0) return byWork;
    // Then the effective time, because that is the one the caller was shown.
    return Number(byEffectiveTime(b)) - Number(byEffectiveTime(a));
  });
  return ranked[0] ?? null;
}

/**
 * Records one intake against an existing regimen.
 *
 * This is the write the MCP server was missing: without it the only way to say
 * "she took half a pill tonight" was `add_medication`, which creates a second
 * medication beside the real course. It follows the web UI's
 * `addOneTimeDoseToRegimen` -- insert the event, then resolve it through the
 * RPC -- because the RPC is what also writes the inventory transaction and
 * decrements stock. Writing `status: 'taken'` straight into the insert would
 * skip that and silently stop the stock ever going down.
 *
 * Unlike the UI, which reaches this path only for intakes outside the plan,
 * this tool is the single way in, so it resolves an existing dose in the same
 * minute -- planned, snoozed or already resolved -- rather than inserting
 * beside it. Saying the same thing twice must not produce two intakes.
 *
 * No dose-event regeneration here: logging an intake records history, it does
 * not change the plan, so the upcoming events stay valid.
 */
export async function logDose(
  supabase: SupabaseClient<Database>,
  params: LogDoseParams,
): Promise<{
  regimen: RegimenWithStatus;
  dose: MedDoseEvent;
  planned: boolean;
  alreadyRecorded: boolean;
}> {
  const { data: regimenRow, error: regimenError } = await supabase
    .from("med_regimens")
    .select("*")
    .eq("id", params.regimenId)
    .is("deleted_at", null)
    .maybeSingle();

  if (regimenError) {
    throw new Error(`Failed to load medication: ${regimenError.message}`);
  }
  if (!regimenRow) {
    throw new Error(`No medication with id ${params.regimenId}.`);
  }

  const regimen = withEffectiveStatus(
    rowToRegimen(regimenRow as unknown as Record<string, unknown>),
  );
  const unit = regimen.dose_definition?.intake?.unit ?? regimen.intake_unit;
  const note = params.note?.trim() ? params.note.trim() : null;

  const planned = await findDoseInSameMinute(
    supabase,
    regimen.id,
    new Date(params.at),
    params.status,
  );

  // Nothing to do when the minute already holds this very outcome. Re-running
  // the RPC would be a silent no-op anyway (it selects only rows in the other
  // statuses), so the caller would be told "recorded" with nothing recorded and
  // no way to tell the two apart.
  if (planned && planned.status === params.status) {
    return {
      regimen,
      dose: rowToDoseEvent(planned),
      planned: true,
      alreadyRecorded: true,
    };
  }

  // A per-slot amount on the planned event beats the regimen's default: a
  // `daily_times` schedule can carry a different amount per time of day.
  const plannedIntake = (planned?.planned_intake ?? null) as PlannedIntake | null;
  const plannedAmount = plannedIntake?.intake?.amount;
  const amount = params.amount ?? plannedAmount ?? getPlannedIntakeAmount(regimen.dose_definition);

  let row: Record<string, unknown>;
  // Set when the planned event's `planned_intake` was rewritten, so the
  // amendment can be undone if the dose never gets resolved.
  let amendedFrom: unknown | undefined;

  if (planned) {
    row = planned;
    // Only when the caller corrected the amount -- otherwise leave the planned
    // intake untouched rather than rewriting it with an identical value.
    if (params.amount != null && params.amount !== plannedAmount) {
      const { error: amendError } = await supabase
        .from("med_dose_events")
        .update({
          // Spread rather than rebuild: `planned_intake` also carries the
          // active ingredients this dose delivers, which the generator
          // deliberately preserves and which are the only record of what was
          // actually taken. Keep the slot's own unit for the same reason --
          // `mark_dose_taken` copies it straight into the inventory ledger.
          planned_intake: {
            ...(plannedIntake ?? {}),
            intake: { amount, unit: plannedIntake?.intake?.unit ?? unit },
          },
        } as never)
        .eq("id", planned.id as string);

      if (amendError) {
        throw new Error(`Failed to record the intake: ${amendError.message}`);
      }
      amendedFrom = planned.planned_intake ?? null;
    }
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("med_dose_events")
      .insert({
        person_id: regimen.person_id,
        regimen_id: regimen.id,
        scheduled_at: params.at,
        actual_at: params.at,
        planned_intake: { intake: { amount, unit }, active: [] },
        status: "scheduled",
      } as never)
      .select("*")
      .single();

    if (insertError || !inserted) {
      throw new Error(`Failed to record the intake: ${insertError?.message ?? "no row returned"}`);
    }
    row = inserted as unknown as Record<string, unknown>;
  }

  const doseEventId = row.id as string;
  const { error: resolveError } = await supabase.rpc(
    params.status === "skipped" ? "mark_dose_skipped" : "mark_dose_taken",
    { p_dose_event_id: doseEventId, ...(note ? { p_note: note } : {}) } as never,
  );

  if (resolveError) {
    // `supabase.rpc` reports a lost response exactly like a rejected call, and
    // the RPC is plpgsql: it may well have committed -- status changed,
    // inventory transaction written, stock decremented -- with only the reply
    // going missing. Ask the row itself before touching anything. Deleting on
    // that path would destroy a real intake while its decrement survived
    // (`med_inventory_transactions.event_id` is ON DELETE SET NULL), and the
    // retry it invites would decrement a second time.
    const { data: afterRow, error: afterError } = await supabase
      .from("med_dose_events")
      .select("*")
      .eq("id", doseEventId)
      .maybeSingle();

    const after = (afterRow as Record<string, unknown> | null) ?? null;

    if (!afterError && after && after.status === params.status) {
      return {
        regimen,
        dose: rowToDoseEvent(after),
        planned: planned !== null,
        alreadyRecorded: false,
      };
    }

    // Blind is not the same as "it did not land". If the row cannot be read
    // back, the safe move is to leave it and say so: an unresolved event is a
    // reminder too many, a deleted one may be a medical record too few.
    if (afterError || !after) {
      throw new Error(
        `Failed to mark the intake as ${params.status}: ${resolveError.message}. ` +
          `Reading dose event ${doseEventId} back failed too ` +
          `(${afterError?.message ?? "no row returned"}), so whether it was recorded on ` +
          `${regimen.custom_name} is unknown and needs checking by hand.`,
      );
    }

    // The row is readable and still unresolved, so the write really did not
    // land. Only now is undoing the right move -- and only for a row this call
    // created.
    if (!planned) {
      // A hard delete, not `deleted_at`: the row is seconds old and carries no
      // history worth keeping, and `idx_med_dose_events_regimen_scheduled_minute`
      // indexes every `scheduled` row whether or not it is soft-deleted. A
      // tombstone would hold that regimen's minute forever, so the next attempt
      // at the same intake -- which cannot see the deleted row -- would fail on
      // a duplicate key with no way back.
      const { error: withdrawError } = await supabase
        .from("med_dose_events")
        .delete()
        .eq("id", doseEventId);

      if (withdrawError) {
        // Both halves failed -- most likely the same outage. Name the row that
        // survived, so it can be resolved by hand instead of silently
        // reminding the person about a dose they already took.
        throw new Error(
          `Failed to mark the intake as ${params.status}: ${resolveError.message}. ` +
            `Withdrawing the event failed too (${withdrawError.message}), so dose event ${doseEventId} ` +
            `is left scheduled on ${regimen.custom_name} and needs resolving by hand.`,
        );
      }
    } else if (amendedFrom !== undefined) {
      // The plan itself is not ours to change on a failed call: put the slot's
      // original amount back, so a rejected intake does not quietly restate
      // what the person is due to take.
      const { error: restoreError } = await supabase
        .from("med_dose_events")
        .update({ planned_intake: amendedFrom } as never)
        .eq("id", doseEventId);

      if (restoreError) {
        throw new Error(
          `Failed to mark the intake as ${params.status}: ${resolveError.message}. ` +
            `Restoring the planned amount failed too (${restoreError.message}), so dose event ${doseEventId} ` +
            `on ${regimen.custom_name} still carries the corrected amount and needs resolving by hand.`,
        );
      }
    }
    throw new Error(`Failed to mark the intake as ${params.status}: ${resolveError.message}`);
  }

  const { data: resolved, error: resolvedError } = await supabase
    .from("med_dose_events")
    .select("*")
    .eq("id", doseEventId)
    .maybeSingle();

  // Falling back to `row` here would report the pre-RPC snapshot -- still
  // `scheduled` -- for a dose that was in fact recorded, and a caller reading
  // that would reasonably log it again. The write succeeded; say so, and say
  // that only the read-back did not.
  if (resolvedError || !resolved) {
    throw new Error(
      `The intake was recorded as ${params.status} on ${regimen.custom_name} (dose event ` +
        `${doseEventId}), but reading it back failed ` +
        `(${resolvedError?.message ?? "no row returned"}). Do not record it again.`,
    );
  }

  return {
    regimen,
    dose: rowToDoseEvent(resolved as Record<string, unknown>),
    planned: planned !== null,
    alreadyRecorded: false,
  };
}
