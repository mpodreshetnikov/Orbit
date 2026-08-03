import type {
  BodySiteCatalogItem,
  FindingTypeCatalogItem,
  ObservationCatalogItem,
} from "./types.ts";

/**
 * Deterministic resolution of extracted labels to catalogue entries.
 *
 * The model is asked for a code but is never trusted to have produced a real one. Resolution
 * runs in tiers, strongest evidence first, and reports which tier succeeded so a weak match can
 * be surfaced differently from an exact one:
 *
 *   code    — the model supplied a code that genuinely exists
 *   name    — the printed label matches a catalogue display name
 *   synonym — the printed label matches a catalogue synonym
 *   fuzzy   — trigram similarity above a threshold
 *
 * Failing all four is a normal outcome, not an error: it means the document contains something
 * the catalogue does not cover, and the row is kept unresolved rather than being forced onto a
 * wrong code.
 */

export type ResolutionVia = "code" | "name" | "synonym" | "fuzzy";

export type CodeResolution<T> =
  | { kind: "resolved"; entry: T; via: ResolutionVia; score: number }
  | { kind: "unresolved"; reason: string };

/**
 * Similarity below this is treated as no match. Tuned to accept ordinary spelling and
 * inflection differences ("гемоглобин" vs "гемоглобина") while rejecting merely related terms —
 * a wrong code is worse than no code, because it silently attaches a value to another analyte's
 * history.
 */
export const FUZZY_THRESHOLD = 0.62;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const result = new Set<string>();
  for (let index = 0; index < padded.length - 2; index++) {
    result.add(padded.slice(index, index + 3));
  }
  return result;
}

/** Dice coefficient over trigrams; 1 is identical, 0 shares nothing. */
export function similarity(left: string, right: string): number {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const setA = trigrams(a);
  const setB = trigrams(b);
  let shared = 0;
  for (const gram of setA) {
    if (setB.has(gram)) shared += 1;
  }
  return (2 * shared) / (setA.size + setB.size);
}

interface CatalogView<T> {
  entry: T;
  code: string;
  names: string[];
  synonyms: string[];
}

function resolveWithViews<T>(
  modelCode: string | null,
  nameText: string | null,
  views: CatalogView<T>[],
): CodeResolution<T> {
  if (modelCode) {
    const byCode = views.find((view) => view.code === modelCode);
    if (byCode) return { kind: "resolved", entry: byCode.entry, via: "code", score: 1 };
  }

  if (!nameText) {
    return {
      kind: "unresolved",
      reason: modelCode ? "model code not in catalogue and no label to fall back on" : "no label",
    };
  }

  const normalizedName = normalize(nameText);

  for (const view of views) {
    if (view.names.some((name) => normalize(name) === normalizedName)) {
      return { kind: "resolved", entry: view.entry, via: "name", score: 1 };
    }
  }

  for (const view of views) {
    if (view.synonyms.some((synonym) => normalize(synonym) === normalizedName)) {
      return { kind: "resolved", entry: view.entry, via: "synonym", score: 1 };
    }
  }

  let best: { view: CatalogView<T>; score: number } | null = null;
  for (const view of views) {
    for (const candidate of [...view.names, ...view.synonyms]) {
      const score = similarity(nameText, candidate);
      if (!best || score > best.score) best = { view, score };
    }
  }

  if (best && best.score >= FUZZY_THRESHOLD) {
    return { kind: "resolved", entry: best.view.entry, via: "fuzzy", score: best.score };
  }

  return { kind: "unresolved", reason: "no catalogue entry above similarity threshold" };
}

export function resolveObservationCode(
  modelCode: string | null,
  nameText: string | null,
  catalog: ObservationCatalogItem[],
): CodeResolution<ObservationCatalogItem> {
  return resolveWithViews(
    modelCode,
    nameText,
    catalog.map((entry) => ({
      entry,
      code: entry.obs_code,
      names: [entry.name_ru, entry.name_en].filter(Boolean),
      synonyms: [...(entry.synonyms_ru ?? []), ...(entry.synonyms_en ?? [])],
    })),
  );
}

export function resolveFindingTypeCode(
  modelCode: string | null,
  nameText: string | null,
  catalog: FindingTypeCatalogItem[],
): CodeResolution<FindingTypeCatalogItem> {
  return resolveWithViews(
    modelCode,
    nameText,
    catalog.map((entry) => ({
      entry,
      code: entry.finding_code,
      names: [entry.name_ru, entry.name_en].filter(Boolean),
      synonyms: [...(entry.synonyms_ru ?? []), ...(entry.synonyms_en ?? [])],
    })),
  );
}

export function resolveBodySiteCode(
  modelCode: string | null,
  nameText: string | null,
  catalog: BodySiteCatalogItem[],
): CodeResolution<BodySiteCatalogItem> {
  return resolveWithViews(
    modelCode,
    nameText,
    catalog.map((entry) => ({
      entry,
      code: entry.site_code,
      names: [entry.name_ru, entry.name_en].filter(Boolean),
      synonyms: [...(entry.synonyms_ru ?? []), ...(entry.synonyms_en ?? [])],
    })),
  );
}
