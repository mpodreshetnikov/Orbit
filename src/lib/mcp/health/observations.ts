import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Observations: lab and vital values extracted from uploaded medical documents.
 *
 * A wrinkle worth knowing: `record_observations` has no `person_id` column. The
 * person is reached by joining through the parent record, which is why every
 * query here uses the `medical_records!inner(...)` embed and filters on
 * `medical_records.person_id`.
 *
 * Only `is_applied` rows from `active` records count as real history -- the
 * others are unreviewed pipeline output or superseded extractions.
 */

export interface ObservationRow {
  id: string;
  record_id: string;
  obs_code: string | null;
  obs_name: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  value_canonical: number | null;
  unit_canonical: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_text: string | null;
  status: string | null;
  is_user_verified: boolean;
  record_date: string | null;
  record_title: string | null;
}

interface RawObservationRow extends Omit<ObservationRow, "record_date" | "record_title"> {
  medical_records: { person_id: string; record_date: string | null; title: string } | null;
}

const OBSERVATION_SELECT = `
  id, record_id, obs_code, obs_name, value_numeric, value_text, unit,
  value_canonical, unit_canonical, ref_range_low, ref_range_high, ref_range_text,
  status, is_user_verified,
  medical_records!inner ( person_id, record_date, title, status )
`;

function flatten(rows: RawObservationRow[]): ObservationRow[] {
  return rows.map((row) => {
    const { medical_records: record, ...rest } = row;
    return {
      ...rest,
      record_date: record?.record_date ?? null,
      record_title: record?.title ?? null,
    };
  });
}

export async function searchObservations(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    obsCode?: string;
    query?: string;
    status?: string;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  },
): Promise<ObservationRow[]> {
  let query = supabase
    .from("record_observations")
    .select(OBSERVATION_SELECT)
    .eq("medical_records.person_id", params.personId)
    .eq("medical_records.status", "active")
    .eq("is_applied", true);

  if (params.obsCode) {
    query = query.eq("obs_code", params.obsCode);
  }
  if (params.query?.trim()) {
    // Escape PostgREST's `or` delimiters so a stray comma or paren in the
    // search text cannot alter the filter expression.
    const needle = params.query.trim().replace(/[,()\\]/g, " ");
    query = query.or(`obs_name.ilike.%${needle}%,obs_code.ilike.%${needle}%`);
  }
  if (params.status) {
    query = query.eq("status", params.status);
  }
  if (params.from) {
    query = query.gte("medical_records.record_date", params.from);
  }
  if (params.to) {
    query = query.lte("medical_records.record_date", params.to);
  }

  const { data, error } = await query
    .order("record_date", { ascending: false, referencedTable: "medical_records" })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    throw new Error(`Failed to search observations: ${error.message}`);
  }

  return flatten((data ?? []) as unknown as RawObservationRow[]);
}

/** Time series for a single analyte, oldest first, for trend questions. */
export async function getObservationHistory(
  supabase: SupabaseClient<Database>,
  params: { personId: string; obsCode: string; limit: number },
): Promise<ObservationRow[]> {
  const { data, error } = await supabase
    .from("record_observations")
    .select(OBSERVATION_SELECT)
    .eq("medical_records.person_id", params.personId)
    .eq("medical_records.status", "active")
    .eq("is_applied", true)
    .eq("obs_code", params.obsCode)
    .limit(params.limit);

  if (error) {
    throw new Error(`Failed to load observation history: ${error.message}`);
  }

  return flatten((data ?? []) as unknown as RawObservationRow[]).sort((a, b) =>
    (a.record_date ?? "").localeCompare(b.record_date ?? ""),
  );
}
