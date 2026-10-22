import type {
  ObservationHistoryPoint,
  ObservationStatus,
  ObservationSummary,
} from "./medical-record";

/** A `record_observations` row as the history selects it, with its record and catalogue joined. */
export interface ObservationListRow {
  id: string;
  record_id: string;
  obs_code: string | null;
  obs_name: string;
  catalog_id: string | null;
  value_numeric: number | null;
  value_text: string | null;
  value_canonical: number | null;
  unit: string | null;
  unit_canonical: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_low_canonical: number | null;
  ref_range_high_canonical: number | null;
  status: string | null;
  created_at: string;
  medical_records: { person_id: string; record_date: string | null; status: string };
  observation_catalog: {
    name_ru: string | null;
    name_en: string | null;
    canonical_unit: string | null;
    default_ref_low: number | null;
    default_ref_high: number | null;
  } | null;
}

/**
 * The history's select: applied observations of the person's active records. Filter it with
 * `.eq("medical_records.person_id", id)`, `.eq("medical_records.status", "active")` and
 * `.eq("is_applied", true)`.
 */
export const OBSERVATION_LIST_SELECT =
  "id, record_id, obs_code, obs_name, catalog_id, value_numeric, value_text, value_canonical, " +
  "unit, unit_canonical, ref_range_low, ref_range_high, ref_range_low_canonical, " +
  "ref_range_high_canonical, status, created_at, " +
  "medical_records!inner(person_id, record_date, status), " +
  "observation_catalog(name_ru, name_en, canonical_unit, synonyms_ru, synonyms_en, default_ref_low, default_ref_high)";

/** Out of range, either way: what the web history marks and lists first. */
export function isAbnormal(status: ObservationStatus | null): boolean {
  return Boolean(status) && status !== "normal" && status !== "unknown";
}

const pointDate = (point: ObservationHistoryPoint) => point.record_date || point.created_at;

/**
 * Groups observations, newest first as the history query returns them, into one summary per code
 * (or per name, when there is no code), each with its history oldest first for the chart. Out of
 * range ones come first, then the most recent, then by name.
 */
export function summarizeObservations(rows: ObservationListRow[]): ObservationSummary[] {
  const byKey = new Map<string, ObservationSummary>();

  for (const r of rows) {
    const key = r.obs_code || r.obs_name.toLowerCase().trim();
    const point: ObservationHistoryPoint = {
      id: r.id,
      record_id: r.record_id,
      record_date: r.medical_records.record_date,
      value_numeric: r.value_numeric,
      value_text: r.value_text,
      value_canonical: r.value_canonical,
      unit: r.unit,
      unit_canonical: r.unit_canonical,
      ref_range_low: r.ref_range_low,
      ref_range_high: r.ref_range_high,
      ref_range_low_canonical: r.ref_range_low_canonical,
      ref_range_high_canonical: r.ref_range_high_canonical,
      status: r.status as ObservationStatus | null,
      created_at: r.created_at,
    };

    const existing = byKey.get(key);
    if (existing) {
      existing.history.push(point);
      existing.measurement_count++;
      continue;
    }
    byKey.set(key, {
      obs_code: r.obs_code || key,
      obs_name: r.obs_name,
      catalog_id: r.catalog_id,
      catalog_name_ru: r.observation_catalog?.name_ru || null,
      catalog_name_en: r.observation_catalog?.name_en || null,
      canonical_unit: r.observation_catalog?.canonical_unit || r.unit_canonical,
      latest_value: r.value_canonical ?? r.value_numeric,
      latest_value_text: r.value_text,
      latest_unit: r.unit_canonical || r.unit,
      latest_status: r.status as ObservationStatus | null,
      latest_date: r.medical_records.record_date,
      latest_ref_low: r.ref_range_low,
      latest_ref_high: r.ref_range_high,
      latest_ref_low_canonical: r.ref_range_low_canonical,
      latest_ref_high_canonical: r.ref_range_high_canonical,
      default_ref_low: r.observation_catalog?.default_ref_low ?? null,
      default_ref_high: r.observation_catalog?.default_ref_high ?? null,
      measurement_count: 1,
      history: [point],
    });
  }

  const summaries = Array.from(byKey.values()).map((summary) => ({
    ...summary,
    history: summary.history.sort(
      (a, b) => new Date(pointDate(a)).getTime() - new Date(pointDate(b)).getTime(),
    ),
  }));

  return summaries.sort((a, b) => {
    const bad = Number(isAbnormal(b.latest_status)) - Number(isAbnormal(a.latest_status));
    if (bad !== 0) return bad;
    const dateA = a.latest_date ? new Date(a.latest_date).getTime() : 0;
    const dateB = b.latest_date ? new Date(b.latest_date).getTime() : 0;
    return dateB - dateA || a.obs_name.localeCompare(b.obs_name);
  });
}

/** Summaries whose name, code or either catalogue name contains `search`, ignoring case. */
export function searchObservationSummaries(
  summaries: ObservationSummary[],
  search: string | undefined,
): ObservationSummary[] {
  const needle = search?.toLowerCase().trim();
  if (!needle) return summaries;
  return summaries.filter((s) =>
    [s.obs_name, s.obs_code, s.catalog_name_ru, s.catalog_name_en].some((text) =>
      text?.toLowerCase().includes(needle),
    ),
  );
}
