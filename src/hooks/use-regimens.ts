"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import { notifySwMedicationIntakeResolved } from "@/lib/sw-messages";
import type {
  MedRegimen,
  MedDoseEvent,
  MedDoseEventWithRegimen,
  MedInventoryTransaction,
  CreateMedRegimenInput,
  UpdateMedRegimenInput,
  MedSchedule,
  MedDuration,
  PlannedIntake,
  RegimenInventory,
} from "@/types/regimen";
import type { MedicationUnit } from "@/types/medication";

function rowToRegimen(row: Record<string, unknown>): MedRegimen {
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    custom_name: row.custom_name as string,
    status: row.status as MedRegimen["status"],
    intake_unit: row.intake_unit as MedicationUnit,
    dose_definition: (row.dose_definition as PlannedIntake | null) ?? null,
    intake_advice_type: (row.intake_advice_type as string | null) ?? null,
    intake_advice_text: (row.intake_advice_text as string | null) ?? null,
    schedule: row.schedule as MedSchedule,
    duration: row.duration as MedDuration,
    reminder_prefs: (row.reminder_prefs as Record<string, unknown> | null) ?? null,
    inventory: (row.inventory as RegimenInventory | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToDoseEvent(row: Record<string, unknown>): MedDoseEvent {
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    regimen_id: row.regimen_id as string,
    scheduled_at: row.scheduled_at as string,
    actual_at: row.actual_at as string,
    planned_intake: (row.planned_intake as PlannedIntake) ?? { intake: { amount: 1, unit: "pill" }, active: [] },
    status: row.status as MedDoseEvent["status"],
    taken_at: (row.taken_at as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToInventoryTransaction(row: Record<string, unknown>): MedInventoryTransaction {
  return {
    id: row.id as string,
    regimen_id: row.regimen_id as string,
    event_id: (row.event_id as string | null) ?? null,
    type: row.type as MedInventoryTransaction["type"],
    amount: Number(row.amount ?? 0),
    unit: row.unit as string,
    note: (row.note as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

// ============================================================================
// REGIMENS
// ============================================================================

async function fetchRegimens(personId: string, status?: string | null): Promise<MedRegimen[]> {
  const supabase = createClient();
  let query = supabase
    .from("med_regimens")
    .select("*")
    .eq("person_id", personId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToRegimen(row));
}

export function useRegimens(personId: string | null, options?: { status?: string | null }) {
  return useQuery({
    queryKey: ["regimens", personId, options?.status],
    queryFn: () => fetchRegimens(personId!, options?.status ?? undefined),
    enabled: !!personId,
  });
}

async function fetchRegimen(regimenId: string): Promise<MedRegimen | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("med_regimens")
    .select("*")
    .eq("id", regimenId)
    .is("deleted_at", null)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  return data ? rowToRegimen(data) : null;
}

export function useRegimen(regimenId: string | null) {
  return useQuery({
    queryKey: ["regimen", regimenId],
    queryFn: () => fetchRegimen(regimenId!),
    enabled: !!regimenId,
  });
}

// ============================================================================
// DOSE EVENTS (today / for dashboard)
// ============================================================================

async function fetchDoseEventsForPerson(
  personId: string,
  dayStartIso: string,
  dayEndIso: string
): Promise<MedDoseEventWithRegimen[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("med_dose_events")
    .select(
      `
      *,
      regimen:med_regimens(custom_name, intake_unit, intake_advice_type, intake_advice_text, schedule)
    `
    )
    .eq("person_id", personId)
    .is("deleted_at", null)
    .gte("actual_at", dayStartIso)
    .lt("actual_at", dayEndIso)
    .in("status", ["scheduled", "sent", "snoozed", "taken", "skipped", "missed"])
    .order("actual_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const event = rowToDoseEvent(row);
    const regimen = row.regimen as {
      custom_name: string;
      intake_unit: string;
      intake_advice_type: string | null;
      intake_advice_text: string | null;
      schedule: MedSchedule | null;
    } | null;
    return { ...event, regimen };
  });
}

export function useDoseEventsForPerson(
  personId: string | null,
  dayStartIso: string,
  dayEndIso: string
) {
  return useQuery({
    queryKey: ["dose-events-person", personId, dayStartIso, dayEndIso],
    queryFn: () => fetchDoseEventsForPerson(personId!, dayStartIso, dayEndIso),
    enabled: !!personId && !!dayStartIso && !!dayEndIso,
  });
}

// ============================================================================
// DOSE EVENTS (history for regimen)
// ============================================================================

const REGIMEN_HISTORY_STATUSES: MedDoseEvent["status"][] = [
  "taken",
  "skipped",
  "missed",
  "scheduled",
  "sent",
  "snoozed",
];

async function fetchDoseEventsForRegimen(regimenId: string): Promise<MedDoseEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("med_dose_events")
    .select("*")
    .eq("regimen_id", regimenId)
    .is("deleted_at", null)
    .in("status", REGIMEN_HISTORY_STATUSES)
    .order("actual_at", { ascending: false });
  if (error) throw new Error(error.message);
  const nowIso = new Date().toISOString();
  const events = (data ?? []).map((row) => rowToDoseEvent(row));
  const filtered = events.filter((ev) => {
    if (ev.status === "taken" || ev.status === "skipped" || ev.status === "missed") return true;
    if (ev.status === "scheduled" || ev.status === "sent" || ev.status === "snoozed") {
      return ev.actual_at < nowIso;
    }
    return false;
  });
  const effectiveDate = (ev: MedDoseEvent) => ev.taken_at ?? ev.actual_at;
  filtered.sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)));
  return filtered;
}

export function useDoseEventsForRegimen(regimenId: string | null) {
  return useQuery({
    queryKey: ["dose-events-regimen", regimenId],
    queryFn: () => fetchDoseEventsForRegimen(regimenId!),
    enabled: !!regimenId,
  });
}

// ============================================================================
// INVENTORY TRANSACTIONS
// ============================================================================

async function fetchInventoryTransactions(regimenId: string): Promise<MedInventoryTransaction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("med_inventory_transactions")
    .select("*")
    .eq("regimen_id", regimenId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToInventoryTransaction(row));
}

export function useInventoryTransactions(regimenId: string | null) {
  return useQuery({
    queryKey: ["inventory-transactions", regimenId],
    queryFn: () => fetchInventoryTransactions(regimenId!),
    enabled: !!regimenId,
  });
}

// ============================================================================
// MUTATIONS: mark taken / skip / snooze
// ============================================================================

async function markDoseTaken(doseEventId: string, note?: string | null): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_dose_taken", {
    p_dose_event_id: doseEventId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export function useMarkDoseTaken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ doseEventId, note }: { doseEventId: string; note?: string | null }) =>
      markDoseTaken(doseEventId, note),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimens"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] });
      notifySwMedicationIntakeResolved([variables.doseEventId]);
    },
  });
}

async function markDoseSkipped(doseEventId: string, note?: string | null): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_dose_skipped", {
    p_dose_event_id: doseEventId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export function useMarkDoseSkipped() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ doseEventId, note }: { doseEventId: string; note?: string | null }) =>
      markDoseSkipped(doseEventId, note),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimens"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] });
      notifySwMedicationIntakeResolved([variables.doseEventId]);
    },
  });
}

async function undoDoseIntake(doseEventId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("undo_dose_intake", {
    p_dose_event_id: doseEventId,
  });
  if (error) throw new Error(error.message);
}

export function useUndoDoseIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ doseEventId }: { doseEventId: string }) => undoDoseIntake(doseEventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimens"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] });
    },
  });
}

async function updateDoseEventResolutionDetails(
  doseEventId: string,
  params: { takenAt?: string | null; amountTaken?: number | null; note?: string | null }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_dose_event_resolution_details", {
    p_dose_event_id: doseEventId,
    p_taken_at: params.takenAt ?? null,
    p_amount_taken: params.amountTaken ?? null,
    p_note: params.note ?? null,
  });
  if (error) throw new Error(error.message);
}

export function useUpdateDoseEventResolutionDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      doseEventId,
      takenAt,
      amountTaken,
      note,
    }: {
      doseEventId: string;
      takenAt?: string | null;
      amountTaken?: number | null;
      note?: string | null;
    }) => updateDoseEventResolutionDetails(doseEventId, { takenAt, amountTaken, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimens"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] });
    },
  });
}

async function snoozeDose(
  doseEventId: string,
  authUserId: string,
  minutesFromNow: number = 15
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("snooze_dose", {
    p_dose_event_id: doseEventId,
    p_auth_user_id: authUserId,
    p_minutes_from_now: minutesFromNow,
  });
  if (error) throw new Error(error.message);
}

export function useSnoozeDose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      doseEventId,
      authUserId,
      minutesFromNow = 15,
    }: {
      doseEventId: string;
      authUserId: string;
      minutesFromNow?: number;
    }) => snoozeDose(doseEventId, authUserId, minutesFromNow),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimens"] });
    },
  });
}

// ============================================================================
// MUTATIONS: regimen CRUD
// ============================================================================

async function createRegimen(input: CreateMedRegimenInput): Promise<MedRegimen> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("med_regimens")
    .insert({
      person_id: input.person_id,
      custom_name: input.custom_name,
      status: input.status ?? "active",
      intake_unit: input.intake_unit ?? "pill",
      dose_definition: input.dose_definition ?? null,
      intake_advice_type: input.intake_advice_type ?? null,
      intake_advice_text: input.intake_advice_text ?? null,
      schedule: input.schedule,
      duration: input.duration,
      reminder_prefs: input.reminder_prefs ?? null,
      inventory: input.inventory ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToRegimen(data);
}

export function useCreateRegimen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRegimen,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["regimens", data.person_id] });
      queryClient.invalidateQueries({ queryKey: ["regimen", data.id] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
    },
  });
}

export interface AddOneTimeDoseToRegimenInput {
  person_id: string;
  regimen_id: string;
  scheduled_at: string;
  amount: number;
  unit: string;
  notes?: string | null;
}

async function addOneTimeDoseToRegimen(input: AddOneTimeDoseToRegimenInput): Promise<void> {
  const supabase = createClient();
  const plannedIntake: PlannedIntake = {
    intake: { amount: input.amount, unit: input.unit },
    active: [],
  };
  const { data: event, error: insertError } = await supabase
    .from("med_dose_events")
    .insert({
      person_id: input.person_id,
      regimen_id: input.regimen_id,
      scheduled_at: input.scheduled_at,
      actual_at: input.scheduled_at,
      planned_intake: plannedIntake,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  if (!event?.id) throw new Error("Failed to create dose event");
  const { error: markError } = await supabase.rpc("mark_dose_taken", {
    p_dose_event_id: event.id,
    p_note: input.notes ?? null,
  });
  if (markError) throw new Error(markError.message);
}

export function useAddOneTimeDoseToRegimen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addOneTimeDoseToRegimen,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
      queryClient.invalidateQueries({ queryKey: ["regimens"] });
      queryClient.invalidateQueries({ queryKey: ["regimen"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions"] });
    },
  });
}

async function updateRegimen({
  id,
  updates,
}: {
  id: string;
  updates: UpdateMedRegimenInput;
}): Promise<MedRegimen> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("med_regimens")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToRegimen(data);
}

export function useUpdateRegimen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateRegimen,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["regimen", data.id] });
      queryClient.invalidateQueries({ queryKey: ["regimens", data.person_id] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen"] });
    },
  });
}

async function deleteRegimen({ id }: { id: string; personId: string }): Promise<void> {
  const supabase = createClient();
  const now = new Date().toISOString();
  const { error: eventsError } = await supabase
    .from("med_dose_events")
    .update({ deleted_at: now })
    .eq("regimen_id", id);
  if (eventsError) throw new Error(eventsError.message);
  const { error: regimenError } = await supabase
    .from("med_regimens")
    .update({ deleted_at: now })
    .eq("id", id);
  if (regimenError) throw new Error(regimenError.message);
}

export function useDeleteRegimen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRegimen,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["regimen", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["regimens", variables.personId] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen", variables.id] });
    },
  });
}

async function archiveRegimen({ id }: { id: string; personId: string }): Promise<void> {
  const supabase = createClient();
  const { error: updateError } = await supabase
    .from("med_regimens")
    .update({ status: "archived" })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);
  const now = new Date().toISOString();
  const { error: deleteError } = await supabase
    .from("med_dose_events")
    .delete()
    .eq("regimen_id", id)
    .in("status", ["scheduled", "sent", "snoozed"])
    .gte("scheduled_at", now);
  if (deleteError) throw new Error(deleteError.message);
}

export function useArchiveRegimen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveRegimen,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["regimen", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["regimens", variables.personId] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-person"] });
      queryClient.invalidateQueries({ queryKey: ["dose-events-regimen", variables.id] });
    },
  });
}

// ============================================================================
// MUTATIONS: update regimen inventory (refill / set_absolute / correction)
// ============================================================================

async function updateRegimenInventory(
  regimenId: string,
  type: "refill" | "set_absolute" | "correction",
  amount: number,
  note?: string | null
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_regimen_inventory", {
    p_regimen_id: regimenId,
    p_type: type,
    p_amount: amount,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export function useUpdateRegimenInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      regimenId,
      type,
      amount,
      note,
    }: {
      regimenId: string;
      type: "refill" | "set_absolute" | "correction";
      amount: number;
      note?: string | null;
    }) => updateRegimenInventory(regimenId, type, amount, note),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["regimen", variables.regimenId] });
      queryClient.invalidateQueries({ queryKey: ["regimens"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-transactions", variables.regimenId] });
    },
  });
}
