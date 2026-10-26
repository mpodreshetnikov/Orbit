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

/**
 * Create several entries in one call, never touching one that exists.
 *
 * `upsertCatalogEntry` overwrites an existing entry's synonyms with whatever it is given, which is
 * the wrong thing to do in bulk: an agent filling the gaps a document showed on 2026-10-26 made 89
 * calls, one entry at a time, and any of them could have wiped a list it did not know about. Here
 * an existing code is reported back and left alone; `addCatalogSynonyms` is how it grows.
 */
export async function createCatalogEntries(
  supabase: SupabaseClient<Database>,
  params: { kind: CatalogKind; entries: Array<Record<string, unknown>> },
): Promise<{ created: Array<Record<string, unknown>>; existing: string[] }> {
  const spec = getCatalogSpec(params.kind);
  const codes = params.entries.map((entry) => String(entry[spec.codeColumn]));
  const repeated = codes.find((code, index) => codes.indexOf(code) !== index);
  if (repeated) {
    throw new Error(`${spec.codeColumn} "${repeated}" appears twice in this batch.`);
  }

  const { data: found, error: lookupError } = await supabase
    .from(spec.table)
    .select(spec.codeColumn)
    .in(spec.codeColumn, codes);
  if (lookupError) {
    throw new Error(`Failed to look up ${spec.label}: ${lookupError.message}`);
  }
  const existing = new Set(
    ((found ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
      String(row[spec.codeColumn]),
    ),
  );
  const fresh = params.entries.filter((entry) => !existing.has(String(entry[spec.codeColumn])));
  if (fresh.length === 0) return { created: [], existing: [...existing] };

  // Entries in one batch may set different optional fields. PostgREST inserts the union of their
  // columns, and without this a field one entry left out is written as NULL rather than its
  // default -- which the NOT NULL synonym and unit columns refuse, failing the whole batch.
  const { data, error } = await supabase
    .from(spec.table)
    .insert(fresh as never, { defaultToNull: false })
    .select(spec.columns);
  if (error) {
    throw new Error(`Failed to create ${spec.label} entries: ${error.message}`);
  }
  return {
    created: (data ?? []) as unknown as Array<Record<string, unknown>>,
    existing: [...existing],
  };
}

/** What adding synonyms to one entry did. */
export interface SynonymChange {
  code: string;
  /** No entry has this code; nothing was written for it. */
  missing: boolean;
  added: string[];
  already_present: string[];
  /** Wordings another entry already answers to, refused so the matcher never has to choose. */
  refused: Array<{ synonym: string; owner: string }>;
}

/**
 * Fold a wording the way the server's matcher compares labels: case, `ё`, punctuation and spacing
 * carry no meaning (`Гамма-ГТ` is `гамма гт`).
 */
function foldWording(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Append wordings to existing entries' synonyms and report exactly what changed.
 *
 * A wording another entry already answers to (by name or synonym) is refused, not added: two
 * entries answering to `pdw` is how PDW in fL got filed into the PDW kept in %, and the matcher
 * takes whichever it meets first. Stored lower-cased, as the catalogue keeps them.
 */
export async function addCatalogSynonyms(
  supabase: SupabaseClient<Database>,
  params: {
    kind: CatalogKind;
    items: Array<{ code: string; synonyms_ru?: string[]; synonyms_en?: string[] }>;
  },
): Promise<SynonymChange[]> {
  const spec = getCatalogSpec(params.kind);
  if (!spec.hasSynonyms) {
    throw new Error(`The ${spec.label} catalog has no synonyms.`);
  }

  const { data, error } = await supabase
    .from(spec.table)
    .select(`id, ${spec.codeColumn}, name_ru, name_en, synonyms_ru, synonyms_en`);
  if (error) {
    throw new Error(`Failed to read ${spec.label}: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  const owners = new Map<string, string>();
  for (const row of rows) {
    const code = String(row[spec.codeColumn]);
    for (const wording of [
      row.name_ru,
      row.name_en,
      ...((row.synonyms_ru as string[] | null) ?? []),
      ...((row.synonyms_en as string[] | null) ?? []),
    ]) {
      if (typeof wording === "string" && !owners.has(foldWording(wording))) {
        owners.set(foldWording(wording), code);
      }
    }
  }

  const changes: SynonymChange[] = [];
  const writtenByCode = new Map<string, { synonyms_ru: string[]; synonyms_en: string[] }>();
  for (const item of params.items) {
    const row = rows.find((candidate) => String(candidate[spec.codeColumn]) === item.code);
    const change: SynonymChange = {
      code: item.code,
      missing: !row,
      added: [],
      already_present: [],
      refused: [],
    };
    changes.push(change);
    if (!row) continue;

    // The same code may come more than once in a batch; each write starts from the one before.
    const written = writtenByCode.get(item.code);
    const next = {
      synonyms_ru: [...(written?.synonyms_ru ?? (row.synonyms_ru as string[] | null) ?? [])],
      synonyms_en: [...(written?.synonyms_en ?? (row.synonyms_en as string[] | null) ?? [])],
    };
    for (const column of ["synonyms_ru", "synonyms_en"] as const) {
      for (const raw of item[column] ?? []) {
        const synonym = raw.trim().toLowerCase();
        const folded = foldWording(synonym);
        if (!folded) continue;
        const owner = owners.get(folded);
        if (owner === item.code) {
          change.already_present.push(synonym);
        } else if (owner) {
          change.refused.push({ synonym, owner });
        } else {
          next[column].push(synonym);
          owners.set(folded, item.code);
          change.added.push(synonym);
        }
      }
    }
    if (change.added.length === 0) continue;

    const { error: updateError } = await supabase
      .from(spec.table)
      .update(next as never)
      .eq("id", row.id as string);
    if (updateError) {
      throw new Error(`Failed to add synonyms to ${item.code}: ${updateError.message}`);
    }
    writtenByCode.set(item.code, next);
  }
  return changes;
}
