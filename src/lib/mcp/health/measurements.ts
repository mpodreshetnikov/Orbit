import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getMeasurementTrend, type MeasurementTrend } from "@/lib/measurement-trend";
import { sortByMeasurementOrder } from "@/lib/measurement-order";
import type { MeasurementCategory } from "@/types";

/**
 * Server-side reads and writes for manually recorded body measurements
 * (`measurements` + `measurement_catalog`).
 *
 * Not to be confused with observations, which are lab values extracted from
 * uploaded documents and live in `record_observations`.
 *
 * These take a Supabase client as their first argument so they can run under
 * the caller's own RLS. The equivalent browser-side logic lives in
 * `src/hooks/use-measurements.ts`; it cannot be reused here because it is
 * bound to the browser client and React Query.
 */

export interface MeasurementPoint {
  id: string;
  value: number;
  measured_at: string;
  notes: string | null;
}

export interface MeasurementSummaryRow {
  code: string;
  catalog_id: string;
  name_en: string;
  name_ru: string;
  unit_en: string;
  unit_ru: string;
  category: MeasurementCategory;
  sort_order: number;
  latest_value: number;
  latest_measured_at: string;
  measurement_count: number;
  trend: MeasurementTrend | null;
  history: MeasurementPoint[];
}

interface RawMeasurementRow {
  id: string;
  catalog_id: string;
  value: number;
  measured_at: string;
  notes: string | null;
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

const CATEGORIES: MeasurementCategory[] = ["basic", "body", "limbs", "vital"];

function normalizeCategory(value: string): MeasurementCategory {
  return (CATEGORIES as string[]).includes(value) ? (value as MeasurementCategory) : "basic";
}

/**
 * Latest value plus full history for each measurement type recorded for a
 * person. Grouped in memory because the rows carry their catalog metadata via
 * an embed rather than a pre-aggregated view.
 */
export async function listMeasurements(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    codes?: string[];
    from?: string;
    to?: string;
    search?: string;
    historyLimit?: number;
  },
): Promise<MeasurementSummaryRow[]> {
  let query = supabase
    .from("measurements")
    .select(
      `id, catalog_id, value, measured_at, notes,
       measurement_catalog ( code, name_ru, name_en, unit_ru, unit_en, category, sort_order )`,
    )
    .eq("person_id", params.personId)
    .order("measured_at", { ascending: false });

  // `from` and `to` are instants, and deciding which instants bound the local
  // days a caller means is the caller's job -- the same division of labour as
  // `listMedicationDoses`. This function used to take bare dates and append
  // `T23:59:59.999Z` to `to`, which bounded the range by the UTC day: east of
  // UTC that drops a late-evening measurement out of the day it belongs to and
  // pulls in one from the next.
  if (params.from) {
    query = query.gte("measured_at", params.from);
  }
  if (params.to) {
    query = query.lte("measured_at", params.to);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load measurements: ${error.message}`);
  }

  const grouped = new Map<string, MeasurementSummaryRow>();

  for (const row of (data ?? []) as unknown as RawMeasurementRow[]) {
    const catalog = row.measurement_catalog;
    if (!catalog) continue;

    const point: MeasurementPoint = {
      id: row.id,
      value: row.value,
      measured_at: row.measured_at,
      notes: row.notes,
    };

    const existing = grouped.get(catalog.code);
    if (existing) {
      existing.history.push(point);
      existing.measurement_count += 1;
      continue;
    }

    grouped.set(catalog.code, {
      code: catalog.code,
      catalog_id: row.catalog_id,
      name_en: catalog.name_en,
      name_ru: catalog.name_ru,
      unit_en: catalog.unit_en,
      unit_ru: catalog.unit_ru,
      category: normalizeCategory(catalog.category),
      sort_order: catalog.sort_order,
      // Rows arrive newest-first, so the first one seen is the latest.
      latest_value: row.value,
      latest_measured_at: row.measured_at,
      measurement_count: 1,
      trend: null,
      history: [point],
    });
  }

  let summaries = Array.from(grouped.values()).map((summary) => {
    // getMeasurementTrend expects oldest-first, same as the UI's history array.
    const history = [...summary.history].sort(
      (a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime(),
    );
    const limited = params.historyLimit ? history.slice(-params.historyLimit) : history;

    return { ...summary, history: limited, trend: getMeasurementTrend(history) };
  });

  if (params.codes?.length) {
    const wanted = new Set(params.codes.map((code) => code.toLowerCase()));
    summaries = summaries.filter((summary) => wanted.has(summary.code.toLowerCase()));
  }

  if (params.search?.trim()) {
    const needle = params.search.trim().toLowerCase();
    summaries = summaries.filter(
      (summary) =>
        summary.code.toLowerCase().includes(needle) ||
        summary.name_en.toLowerCase().includes(needle) ||
        summary.name_ru.toLowerCase().includes(needle),
    );
  }

  // Keeps paired limbs (bicep_left / bicep_right) adjacent, matching the UI.
  return sortByMeasurementOrder(summaries);
}

export async function getMeasurementCatalogEntryByCode(
  supabase: SupabaseClient<Database>,
  code: string,
): Promise<{ id: string; code: string; name_en: string; unit_en: string } | null> {
  const { data, error } = await supabase
    .from("measurement_catalog")
    .select("id, code, name_en, unit_en")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up measurement type: ${error.message}`);
  }
  return data ?? null;
}

export async function addMeasurement(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    catalogId: string;
    value: number;
    measuredAt?: string;
    notes?: string | null;
    createdByUserId: string;
  },
): Promise<{ id: string; value: number; measured_at: string }> {
  const { data, error } = await supabase
    .from("measurements")
    .insert({
      person_id: params.personId,
      catalog_id: params.catalogId,
      value: params.value,
      measured_at: params.measuredAt ?? new Date().toISOString(),
      notes: params.notes ?? null,
      created_by_user_id: params.createdByUserId,
    })
    .select("id, value, measured_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to record measurement: ${error?.message ?? "no row returned"}`);
  }
  return data;
}
