import type { MeasurementSummary } from "@orbit-types/measurement";
import {
  MEASUREMENT_LIST_SELECT,
  summarizeMeasurements,
  type MeasurementListRow,
} from "@orbit-types/measurement-summary";
import {
  hiddenCodesForPerson,
  normalizeHiddenMeasurementCodes,
} from "@orbit-types/measurement-visibility";
import { supabase } from "@/lib/supabase";

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/**
 * A person's measurements, one summary per type — the web app's `fetchPersonMeasurements` — less
 * the types the account hid for them on the web's list.
 */
export async function fetchMeasurements(
  personId: string,
  userId: string,
): Promise<MeasurementSummary[]> {
  const rows = check(
    await supabase
      .from("measurements")
      .select(MEASUREMENT_LIST_SELECT)
      .eq("person_id", personId)
      .order("measured_at", { ascending: false }),
  );
  const preferences = check(
    await supabase
      .from("user_preferences")
      .select("hidden_measurement_codes")
      .eq("auth_user_id", userId)
      .maybeSingle(),
  ) as { hidden_measurement_codes?: unknown } | null;
  const hidden = hiddenCodesForPerson(
    normalizeHiddenMeasurementCodes(preferences?.hidden_measurement_codes),
    personId,
  );
  return summarizeMeasurements((rows ?? []) as unknown as MeasurementListRow[]).filter(
    (summary) => !hidden.has(summary.code),
  );
}

export async function deleteMeasurement(id: string) {
  check(await supabase.from("measurements").delete().eq("id", id));
}
