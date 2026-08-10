import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { rowToDoseEvent, rowToInventoryTransaction, rowToRegimen } from "@/lib/regimen-mappers";
import { getEffectiveStatus } from "@/types/regimen";
import type { MedDoseEvent, MedRegimen } from "@/types/regimen";

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

export async function listMedications(
  supabase: SupabaseClient<Database>,
  params: { personId: string; status?: string; search?: string; includeArchived?: boolean },
): Promise<RegimenWithStatus[]> {
  let query = supabase
    .from("med_regimens")
    .select("*")
    .eq("person_id", params.personId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (params.status) {
    query = query.eq("status", params.status as never);
  } else if (!params.includeArchived) {
    query = query.neq("status", "archived");
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load medications: ${error.message}`);
  }

  let regimens = ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .map(rowToRegimen)
    .map(withEffectiveStatus);

  if (params.search?.trim()) {
    const needle = params.search.trim().toLowerCase();
    regimens = regimens.filter((regimen) => regimen.custom_name.toLowerCase().includes(needle));
  }

  return regimens;
}

export async function getMedication(
  supabase: SupabaseClient<Database>,
  params: { regimenId: string; horizonDays: number },
): Promise<{
  regimen: RegimenWithStatus | null;
  upcomingDoses: MedDoseEvent[];
  recentDoses: MedDoseEvent[];
  inventoryTransactions: ReturnType<typeof rowToInventoryTransaction>[];
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

  const { data: events } = await supabase
    .from("med_dose_events")
    .select("*")
    .eq("regimen_id", params.regimenId)
    .is("deleted_at", null)
    .gte("scheduled_at", recentStart.toISOString())
    .lte("scheduled_at", horizonEnd.toISOString())
    .order("scheduled_at", { ascending: true });

  const doses = ((events ?? []) as unknown as Array<Record<string, unknown>>).map(rowToDoseEvent);

  const { data: transactions } = await supabase
    .from("med_inventory_transactions")
    .select("*")
    .eq("regimen_id", params.regimenId)
    .order("created_at", { ascending: false })
    .limit(20);

  return {
    regimen,
    upcomingDoses: doses.filter((dose) => new Date(dose.scheduled_at) >= now),
    recentDoses: doses.filter((dose) => new Date(dose.scheduled_at) < now),
    inventoryTransactions: ((transactions ?? []) as unknown as Array<Record<string, unknown>>).map(
      rowToInventoryTransaction,
    ),
  };
}

export async function listMedicationDoses(
  supabase: SupabaseClient<Database>,
  params: { personId: string; from: string; to: string; status?: string },
): Promise<Array<MedDoseEvent & { medication_name: string | null }>> {
  let query = supabase
    .from("med_dose_events")
    .select("*, regimen:med_regimens ( custom_name )")
    .eq("person_id", params.personId)
    .is("deleted_at", null)
    .gte("scheduled_at", params.from)
    .lte("scheduled_at", params.to)
    .order("scheduled_at", { ascending: true });

  if (params.status) {
    query = query.eq("status", params.status as never);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load medication intakes: ${error.message}`);
  }

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    ...rowToDoseEvent(row),
    medication_name: (row.regimen as { custom_name?: string } | null)?.custom_name ?? null,
  }));
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
