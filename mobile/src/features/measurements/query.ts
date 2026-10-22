import type { MeasurementSummary } from "@orbit-types/measurement";
import {
  MEASUREMENT_LIST_SELECT,
  summarizeMeasurements,
  type MeasurementListRow,
} from "@orbit-types/measurement-summary";
import { supabase } from "@/lib/supabase";

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

export async function deleteMeasurement(id: string) {
  check(await supabase.from("measurements").delete().eq("id", id));
}
