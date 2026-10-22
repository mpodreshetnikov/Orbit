import type { ObservationSummary } from "@orbit-types/medical-record";
import {
  OBSERVATION_LIST_SELECT,
  summarizeObservations,
  type ObservationListRow,
} from "@orbit-types/observation-summary";
import { supabase } from "@/lib/supabase";

/** The person's lab values, one summary per test — the web app's `fetchPersonObservationHistory`. */
export async function fetchObservations(personId: string): Promise<ObservationSummary[]> {
  const { data, error } = await supabase
    .from("record_observations")
    .select(OBSERVATION_LIST_SELECT)
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .eq("is_applied", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return summarizeObservations((data ?? []) as unknown as ObservationListRow[]);
}
