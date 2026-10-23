import type { BodySiteCatalog, FindingTypeCatalog } from "./finding";

/**
 * The finding-type and body-site catalogues' logic apart from the screens that draw them: the web
 * pages and the phone search, add synonyms and offer parents the same way.
 */

/** What both catalogues' entries share, beside their own code. */
export type CatalogEntryNames = Pick<
  FindingTypeCatalog,
  "name_ru" | "name_en" | "synonyms_ru" | "synonyms_en"
>;

/** Whether an entry's code, names or synonyms hold the query, ignoring case; an empty one does. */
export function matchesCatalogEntry(
  code: string,
  entry: CatalogEntryNames,
  query: string,
): boolean {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  return [
    code,
    entry.name_ru,
    entry.name_en,
    ...(entry.synonyms_ru ?? []),
    ...(entry.synonyms_en ?? []),
  ].some((text) => text.toLowerCase().includes(search));
}

/** The synonyms with one more, lower-cased; null when it is empty or there already. */
export function addSynonym(synonyms: string[], text: string): string[] | null {
  const synonym = text.trim().toLowerCase();
  return synonym && !synonyms.includes(synonym) ? [...synonyms, synonym] : null;
}

/** The sites a site can sit under: any but itself and the sites under it, so no loop forms. */
export function parentCandidates(
  all: BodySiteCatalog[],
  site: Pick<BodySiteCatalog, "id" | "site_code"> | null | undefined,
): BodySiteCatalog[] {
  if (!site) return all;
  return all.filter((candidate) => {
    if (candidate.id === site.id) return false;
    // A chain that repeats is already a loop in the data (nothing in the database forbids one):
    // stop there, and offer nothing on it.
    const seen = new Set<string>();
    let current = candidate;
    while (current.parent_site_code) {
      if (current.parent_site_code === site.site_code) return false;
      if (seen.has(current.site_code)) return false;
      seen.add(current.site_code);
      const parent = all.find((one) => one.site_code === current.parent_site_code);
      if (!parent) break;
      current = parent;
    }
    return true;
  });
}
