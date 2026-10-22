import type {
  MeasurementCategory,
  MeasurementHistoryPoint,
  MeasurementSummary,
} from "./measurement";
import { sortByMeasurementOrder } from "./measurement-order";

/** A `measurements` row as the list selects it, with its catalog entry joined. */
export interface MeasurementListRow {
  id: string;
  catalog_id: string;
  value: number;
  measured_at: string;
  notes: string | null;
  created_at: string;
  measurement_catalog: {
    code: string;
    name_ru: string;
    name_en: string;
    unit_ru: string;
    unit_en: string;
    category: string;
    sort_order: number;
  } | null;
}

/** The list's select, shared so the web app and the iOS client ask for the same columns. */
export const MEASUREMENT_LIST_SELECT =
  "id, person_id, catalog_id, value, measured_at, notes, created_by_user_id, created_at, " +
  "measurement_catalog (code, name_ru, name_en, unit_ru, unit_en, category, sort_order)";

export function normalizeMeasurementCategory(value: string): MeasurementCategory {
  if (value === "basic" || value === "body" || value === "limbs" || value === "vital") {
    return value;
  }
  return "basic";
}

/**
 * Groups a person's measurements, newest first as the list query returns them, into one summary
 * per catalog code: the latest value and date, the count, and the history oldest first for charts.
 * Sorted by category, then the catalog's `sort_order`, so left/right pairs stay together.
 */
export function summarizeMeasurements(rows: MeasurementListRow[]): MeasurementSummary[] {
  const byCode = new Map<string, MeasurementSummary>();

  for (const row of rows) {
    const catalog = row.measurement_catalog;
    if (!catalog) continue;

    const point: MeasurementHistoryPoint = {
      id: row.id,
      value: row.value,
      measured_at: row.measured_at,
      notes: row.notes,
      created_at: row.created_at,
    };

    const existing = byCode.get(catalog.code);
    if (existing) {
      existing.history.push(point);
      existing.measurement_count++;
    } else {
      byCode.set(catalog.code, {
        code: catalog.code,
        catalog_id: row.catalog_id,
        name_ru: catalog.name_ru,
        name_en: catalog.name_en,
        unit_ru: catalog.unit_ru,
        unit_en: catalog.unit_en,
        category: normalizeMeasurementCategory(catalog.category),
        sort_order: catalog.sort_order,
        latest_value: row.value,
        latest_date: row.measured_at,
        measurement_count: 1,
        history: [point],
      });
    }
  }

  const summaries = Array.from(byCode.values()).map((summary) => ({
    ...summary,
    history: summary.history.sort(
      (a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime(),
    ),
  }));
  return sortByMeasurementOrder(summaries);
}

/** Summaries whose code or either name contains `search`, ignoring case; all of them when blank. */
export function searchMeasurementSummaries<
  T extends Pick<MeasurementSummary, "code" | "name_ru" | "name_en">,
>(summaries: T[], search: string | undefined): T[] {
  const needle = search?.toLowerCase().trim();
  if (!needle) return summaries;
  return summaries.filter(
    (s) =>
      s.code.toLowerCase().includes(needle) ||
      s.name_ru.toLowerCase().includes(needle) ||
      s.name_en.toLowerCase().includes(needle),
  );
}
