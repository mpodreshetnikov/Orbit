import type { BodySiteCatalog, FindingTypeCatalog } from "@orbit-types/finding";
import { supabase } from "@/lib/supabase";

/** The two catalogues findings are described with: what a finding is, and where it is. */
export type ClinicalCatalogKind = "finding-types" | "body-sites";

/** One entry of either catalogue, its code under one name; a body site may sit under another. */
export interface ClinicalEntry {
  id: string;
  code: string;
  name_ru: string;
  name_en: string;
  parent_code: string | null;
  synonyms_ru: string[];
  synonyms_en: string[];
  notes: string | null;
}

export type ClinicalColumns = Omit<ClinicalEntry, "id">;

const TABLE = {
  "finding-types": "finding_type_catalog",
  "body-sites": "body_site_catalog",
} as const;

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** Every entry, by code, as the web pages order them. */
export async function fetchClinicalCatalog(kind: ClinicalCatalogKind): Promise<ClinicalEntry[]> {
  if (kind === "finding-types") {
    const rows = check(
      await supabase.from(TABLE[kind]).select("*").order("finding_code"),
    ) as FindingTypeCatalog[];
    return rows.map(({ finding_code, ...row }) => ({
      ...row,
      code: finding_code,
      parent_code: null,
    }));
  }
  const rows = check(
    await supabase.from(TABLE[kind]).select("*").order("site_code"),
  ) as BodySiteCatalog[];
  return rows.map(({ site_code, parent_site_code, ...row }) => ({
    ...row,
    code: site_code,
    parent_code: parent_site_code,
  }));
}

/** Add an entry, change one by `id`, or delete it when `columns` is null. */
export async function saveClinicalEntry(
  kind: ClinicalCatalogKind,
  id: string | undefined,
  columns: ClinicalColumns | null,
): Promise<void> {
  if (!columns) {
    check(await supabase.from(TABLE[kind]).delete().eq("id", id!));
    return;
  }
  const { code, parent_code, ...rest } = columns;
  if (kind === "finding-types") {
    const table = supabase.from(TABLE[kind]);
    const row = { ...rest, finding_code: code };
    check(id ? await table.update(row).eq("id", id) : await table.insert(row));
    return;
  }
  const table = supabase.from(TABLE[kind]);
  const row = { ...rest, site_code: code, parent_site_code: parent_code };
  check(id ? await table.update(row).eq("id", id) : await table.insert(row));
}
