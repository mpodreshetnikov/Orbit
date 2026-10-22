import type { MeasurementCatalog, MeasurementSummary } from "@orbit-types/measurement";
import { sortByMeasurementOrder } from "@orbit-types/measurement-order";
import {
  MEASUREMENT_LIST_SELECT,
  summarizeMeasurements,
  type MeasurementListRow,
} from "@orbit-types/measurement-summary";
import {
  normalizeHiddenMeasurementCodes,
  type HiddenMeasurementCodes,
} from "@orbit-types/measurement-visibility";
import { supabase } from "@/lib/supabase";

/** One value to write: a new entry, or the changed columns of an existing one. */
export interface MeasurementEntry {
  value: number;
  measured_at: string;
  notes: string | null;
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** A person's measurements, one summary per type — the web app's `fetchPersonMeasurements`. */
export async function fetchMeasurements(personId: string): Promise<MeasurementSummary[]> {
  const rows = check(
    await supabase
      .from("measurements")
      .select(MEASUREMENT_LIST_SELECT)
      .eq("person_id", personId)
      .order("measured_at", { ascending: false }),
  );
  return summarizeMeasurements((rows ?? []) as unknown as MeasurementListRow[]);
}

/** Every measurement type, in the list's order. */
export async function fetchMeasurementCatalog(): Promise<MeasurementCatalog[]> {
  const rows = check(await supabase.from("measurement_catalog").select("*"));
  return sortByMeasurementOrder((rows ?? []) as MeasurementCatalog[]);
}

export async function createMeasurement(
  userId: string,
  personId: string,
  catalogId: string,
  entry: MeasurementEntry,
) {
  check(
    await supabase.from("measurements").insert({
      person_id: personId,
      catalog_id: catalogId,
      created_by_user_id: userId,
      ...entry,
    }),
  );
}

export async function updateMeasurement(id: string, entry: MeasurementEntry) {
  check(await supabase.from("measurements").update(entry).eq("id", id));
}

export async function deleteMeasurement(id: string) {
  check(await supabase.from("measurements").delete().eq("id", id));
}

/** The user's hidden types for every person, as `user_preferences` holds them. */
export async function fetchHiddenCodes(userId: string): Promise<HiddenMeasurementCodes> {
  const row = check(
    await supabase
      .from("user_preferences")
      .select("hidden_measurement_codes")
      .eq("auth_user_id", userId)
      .maybeSingle(),
  );
  return normalizeHiddenMeasurementCodes(row?.hidden_measurement_codes);
}

export async function saveHiddenCodes(userId: string, hidden: HiddenMeasurementCodes) {
  check(
    await supabase
      .from("user_preferences")
      .upsert(
        { auth_user_id: userId, hidden_measurement_codes: hidden },
        { onConflict: "auth_user_id" },
      ),
  );
}
