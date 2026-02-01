"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  Medication,
  MedicationIntake,
  CreateMedicationInput,
  UpdateMedicationInput,
  CreateMedicationIntakeInput,
  UpdateMedicationIntakeInput,
  MedicationsFilters,
  MedicationSchedule,
  MedicationScheduleFrequency,
  MedicationReminderSlot,
} from "@/types";

function normalizeSchedule(schedule: unknown): MedicationSchedule | null {
  if (!schedule || typeof schedule !== "object") return null;
  const s = schedule as Record<string, unknown>;
  const frequency = s.frequency as MedicationScheduleFrequency | undefined;
  const duration = s.duration as MedicationSchedule["duration"] | undefined;
  const rawReminders = s.reminder_times;
  const reminder_times: MedicationReminderSlot[] = Array.isArray(rawReminders)
    ? (rawReminders as unknown[]).filter(
        (r): r is MedicationReminderSlot =>
          r != null &&
          typeof r === "object" &&
          typeof (r as { time: unknown }).time === "string" &&
          typeof (r as { amount: unknown }).amount === "number"
      )
    : [];
  if (!frequency || !duration) return null;
  return { frequency, duration, reminder_times };
}

function rowToMedication(row: Record<string, unknown>): Medication {
  const schedule =
    row.kind === "regular" && row.schedule
      ? normalizeSchedule(row.schedule)
      : null;
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    name: row.name as string,
    kind: row.kind as Medication["kind"],
    unit: row.unit as Medication["unit"],
    dose_per_unit: (row.dose_per_unit as string | null) ?? null,
    intake_advice: (row.intake_advice as string | null) ?? null,
    intake_advice_custom: (row.intake_advice_custom as string | null) ?? null,
    scheduled_at: (row.scheduled_at as string | null) ?? null,
    one_time_amount:
      row.one_time_amount != null ? Number(row.one_time_amount) : null,
    schedule,
    inventory_enabled: Boolean(row.inventory_enabled),
    inventory_current:
      row.inventory_current != null ? Number(row.inventory_current) : null,
    inventory_refill_threshold:
      row.inventory_refill_threshold != null
        ? Number(row.inventory_refill_threshold)
        : null,
    status: row.status as Medication["status"],
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToMedicationIntake(row: Record<string, unknown>): MedicationIntake {
  return {
    id: row.id as string,
    medication_id: row.medication_id as string,
    taken_at: row.taken_at as string,
    amount: Number(row.amount ?? 1),
    skipped: Boolean(row.skipped),
    note: (row.note as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

// ============================================================================
// MEDICATIONS
// ============================================================================

async function fetchMedications(
  personId: string,
  filters: MedicationsFilters = {}
): Promise<Medication[]> {
  const supabase = createClient();

  let query = supabase
    .from("medications")
    .select("*")
    .eq("person_id", personId)
    .order("created_at", { ascending: false });

  if (filters.kind) {
    query = query.eq("kind", filters.kind);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row) => rowToMedication(row));
}

export function useMedications(
  personId: string | null,
  filters: MedicationsFilters = {}
) {
  return useQuery({
    queryKey: ["medications", personId, filters],
    queryFn: () => fetchMedications(personId!, filters),
    enabled: !!personId,
  });
}

// ============================================================================
// SINGLE MEDICATION
// ============================================================================

async function fetchMedication(medicationId: string): Promise<Medication | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medications")
    .select("*")
    .eq("id", medicationId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }

  return data ? rowToMedication(data) : null;
}

export function useMedication(medicationId: string | null) {
  return useQuery({
    queryKey: ["medication", medicationId],
    queryFn: () => fetchMedication(medicationId!),
    enabled: !!medicationId,
  });
}

// ============================================================================
// MEDICATION INTAKES (history)
// ============================================================================

async function fetchMedicationIntakes(
  medicationId: string
): Promise<MedicationIntake[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medication_intakes")
    .select("*")
    .eq("medication_id", medicationId)
    .order("taken_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row) => rowToMedicationIntake(row));
}

export function useMedicationIntakes(medicationId: string | null) {
  return useQuery({
    queryKey: ["medication-intakes", medicationId],
    queryFn: () => fetchMedicationIntakes(medicationId!),
    enabled: !!medicationId,
  });
}

// ============================================================================
// INTAKES TODAY (for dashboard: per-slot resolution)
// ============================================================================

export interface MedicationIntakeTodayRow {
  medication_id: string;
  taken_at: string;
}

async function fetchMedicationIntakesToday(
  medicationIds: string[],
  dateStr: string
): Promise<MedicationIntakeTodayRow[]> {
  if (medicationIds.length === 0) return [];
  const supabase = createClient();
  const start = `${dateStr}T00:00:00.000Z`;
  const [y, m, d] = dateStr.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const end = nextDay.toISOString();

  const { data, error } = await supabase
    .from("medication_intakes")
    .select("medication_id, taken_at")
    .in("medication_id", medicationIds)
    .gte("taken_at", start)
    .lt("taken_at", end)
    .order("taken_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    medication_id: row.medication_id as string,
    taken_at: row.taken_at as string,
  }));
}

export function useMedicationIntakesToday(
  medicationIds: string[] | null,
  dateStr: string
) {
  return useQuery({
    queryKey: ["medication-intakes-today", medicationIds, dateStr],
    queryFn: () => fetchMedicationIntakesToday(medicationIds!, dateStr),
    enabled: !!medicationIds && medicationIds.length > 0 && !!dateStr,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

async function createMedication(
  input: CreateMedicationInput
): Promise<Medication> {
  const supabase = createClient();

  const payload: Record<string, unknown> = {
    person_id: input.person_id,
    name: input.name,
    kind: input.kind,
    unit: input.unit,
    dose_per_unit: input.dose_per_unit ?? null,
    intake_advice: input.intake_advice ?? null,
    intake_advice_custom: input.intake_advice_custom ?? null,
    scheduled_at: input.scheduled_at ?? null,
    one_time_amount:
      input.kind === "one_time" && input.one_time_amount != null
        ? input.one_time_amount
        : null,
    schedule:
      input.kind === "regular" && input.schedule
        ? (input.schedule as unknown as Record<string, unknown>)
        : null,
    inventory_enabled: input.inventory_enabled ?? false,
    inventory_current: input.inventory_current ?? null,
    inventory_refill_threshold: input.inventory_refill_threshold ?? null,
    status: input.status ?? "active",
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase
    .from("medications")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToMedication(data);
}

export function useCreateMedication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMedication,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["medications", data.person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication-intakes-today"],
      });
    },
  });
}

async function updateMedication({
  id,
  updates,
}: {
  id: string;
  updates: UpdateMedicationInput;
}): Promise<Medication> {
  const supabase = createClient();

  const payload: Record<string, unknown> = { ...updates };
  if (updates.schedule !== undefined) {
    payload.schedule =
      updates.schedule != null
        ? (updates.schedule as unknown as Record<string, unknown>)
        : null;
  }

  const { data, error } = await supabase
    .from("medications")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToMedication(data);
}

export function useUpdateMedication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMedication,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["medication", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medications", data.person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication-intakes-today"],
      });
    },
  });
}

async function deleteMedication({
  id,
  personId: _personId,
}: {
  id: string;
  personId: string;
}): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from("medications").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteMedication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMedication,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["medications", variables.personId],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication", variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication-intakes-today"],
      });
    },
  });
}

// ============================================================================
// LOG INTAKE (inventory decrement is done by DB trigger)
// ============================================================================

async function createMedicationIntake(
  input: CreateMedicationIntakeInput
): Promise<MedicationIntake> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medication_intakes")
    .insert({
      medication_id: input.medication_id,
      taken_at: input.taken_at ?? new Date().toISOString(),
      amount: input.amount ?? 1,
      skipped: input.skipped ?? false,
      note: input.note ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToMedicationIntake(data);
}

export function useCreateMedicationIntake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMedicationIntake,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["medication-intakes", data.medication_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication", data.medication_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication-intakes-today"],
      });
    },
  });
}

async function updateMedicationIntake({
  id,
  medicationId: _medicationId,
  updates,
}: {
  id: string;
  medicationId: string;
  updates: UpdateMedicationIntakeInput;
}): Promise<MedicationIntake> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medication_intakes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToMedicationIntake(data);
}

export function useUpdateMedicationIntake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMedicationIntake,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["medication-intakes", data.medication_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication", data.medication_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medications"],
      });
    },
  });
}

async function deleteMedicationIntake({
  id,
  medicationId: _medicationId,
}: {
  id: string;
  medicationId: string;
}): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("medication_intakes")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteMedicationIntake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMedicationIntake,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["medication-intakes", variables.medicationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["medication", variables.medicationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["medications"],
      });
    },
  });
}
