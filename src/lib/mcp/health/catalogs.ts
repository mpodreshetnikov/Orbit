import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The four reference catalogs the health domain resolves free text against:
 * lab analytes, body-measurement types, finding types and body sites.
 *
 * They share enough structure to sit behind one interface, but differ in their
 * key column and which fields exist -- notably, `measurement_catalog` has no
 * synonym arrays, so searching it must not reference them.
 */

export type CatalogKind = "observation" | "measurement" | "finding_type" | "body_site";

interface CatalogSpec {
  table:
    | "observation_catalog"
    | "measurement_catalog"
    | "finding_type_catalog"
    | "body_site_catalog";
  /** The natural key users refer to entries by. */
  codeColumn: string;
  columns: string;
  hasSynonyms: boolean;
  label: string;
}

export const CATALOG_SPECS: Record<CatalogKind, CatalogSpec> = {
  observation: {
    table: "observation_catalog",
    codeColumn: "obs_code",
    columns:
      "id, obs_code, name_ru, name_en, canonical_unit, synonyms_ru, synonyms_en, accepted_units, default_ref_low, default_ref_high, notes",
    hasSynonyms: true,
    label: "lab analyte types",
  },
  measurement: {
    table: "measurement_catalog",
    codeColumn: "code",
    columns: "id, code, name_ru, name_en, unit_ru, unit_en, category, sort_order",
    // No synonym columns on this table -- referencing them would error.
    hasSynonyms: false,
    label: "body measurement types",
  },
  finding_type: {
    table: "finding_type_catalog",
    codeColumn: "finding_code",
    columns: "id, finding_code, name_ru, name_en, synonyms_ru, synonyms_en, notes",
    hasSynonyms: true,
    label: "finding types",
  },
  body_site: {
    table: "body_site_catalog",
    codeColumn: "site_code",
    columns: "id, site_code, name_ru, name_en, parent_site_code, synonyms_ru, synonyms_en, notes",
    hasSynonyms: true,
    label: "body sites",
  },
};

export function getCatalogSpec(kind: CatalogKind): CatalogSpec {
  return CATALOG_SPECS[kind];
}

export async function listCatalogEntries(
  supabase: SupabaseClient<Database>,
  params: { kind: CatalogKind; limit: number; offset: number; category?: string },
): Promise<Array<Record<string, unknown>>> {
  const spec = getCatalogSpec(params.kind);

  let query = supabase
    .from(spec.table)
    .select(spec.columns)
    .order(spec.codeColumn, { ascending: true });

  if (params.category && params.kind === "measurement") {
    query = query.eq("category", params.category);
  }

  const { data, error } = await query.range(params.offset, params.offset + params.limit - 1);
  if (error) {
    throw new Error(`Failed to list ${spec.label}: ${error.message}`);
  }

  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

export async function searchCatalogEntries(
  supabase: SupabaseClient<Database>,
  params: { kind: CatalogKind; query: string; limit: number },
): Promise<Array<Record<string, unknown>>> {
  const spec = getCatalogSpec(params.kind);
  // Strip PostgREST's `or` delimiters so search text cannot alter the filter.
  const needle = params.query.trim().replace(/[,()\\]/g, " ");

  const filters = [
    `${spec.codeColumn}.ilike.%${needle}%`,
    `name_en.ilike.%${needle}%`,
    `name_ru.ilike.%${needle}%`,
  ];

  const { data, error } = await supabase
    .from(spec.table)
    .select(spec.columns)
    .or(filters.join(","))
    .order(spec.codeColumn, { ascending: true })
    .limit(params.limit);

  if (error) {
    throw new Error(`Failed to search ${spec.label}: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  // Synonyms are text arrays, which PostgREST cannot ilike inside an `or`, so
  // they are matched here and merged in. Catalogs are small (hundreds of rows),
  // so a second scoped query is cheap.
  if (!spec.hasSynonyms) {
    return rows;
  }

  const lowered = needle.toLowerCase();
  const { data: all } = await supabase.from(spec.table).select(spec.columns);
  const bySynonym = ((all ?? []) as unknown as Array<Record<string, unknown>>).filter((row) => {
    const synonyms = [
      ...((row.synonyms_en as string[] | null) ?? []),
      ...((row.synonyms_ru as string[] | null) ?? []),
    ];
    return synonyms.some((synonym) => synonym.toLowerCase().includes(lowered));
  });

  const seen = new Set(rows.map((row) => row.id as string));
  for (const row of bySynonym) {
    if (!seen.has(row.id as string) && rows.length < params.limit) {
      rows.push(row);
      seen.add(row.id as string);
    }
  }

  return rows;
}

export async function upsertCatalogEntry(
  supabase: SupabaseClient<Database>,
  params: { kind: CatalogKind; id?: string; values: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const spec = getCatalogSpec(params.kind);

  if (params.id) {
    const { data, error } = await supabase
      .from(spec.table)
      .update(params.values as never)
      .eq("id", params.id)
      .select(spec.columns)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update ${spec.label} entry: ${error.message}`);
    }
    if (!data) {
      throw new Error(`No ${spec.label} entry with id ${params.id}.`);
    }
    return data as unknown as Record<string, unknown>;
  }

  // Upsert on the natural key so re-running with the same code updates rather
  // than failing on the unique constraint.
  const { data, error } = await supabase
    .from(spec.table)
    .upsert(params.values as never, { onConflict: spec.codeColumn })
    .select(spec.columns)
    .single();

  if (error || !data) {
    throw new Error(`Failed to save ${spec.label} entry: ${error?.message ?? "no row returned"}`);
  }
  return data as unknown as Record<string, unknown>;
}
