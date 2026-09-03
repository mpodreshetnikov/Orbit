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

/**
 * Words shorter than this carry too few trigrams to distinguish anything, and folding them in
 * would reject ordinary matches over a stray preposition.
 */
const DISCRIMINATING_TOKEN_MIN_LENGTH = 3;

/** A token is accounted for by a word this close to it; below, they are different words. */
const TOKEN_MATCH_THRESHOLD = 0.5;

/**
 * Tokens shorter than this are treated as abbreviations and must match exactly.
 *
 * Six is chosen so that the lipid fractions -- `лпвп`, `лпнп`, `лпонп` -- all fall inside it, since
 * they are the case that proves the point: one letter apart, three different analytes.
 */
const ABBREVIATION_MAX_LENGTH = 6;

/**
 * Words that say which specimen was measured, not which analyte was measured in it.
 *
 * `Глюкоза крови`, `Глюкоза плазмы` and `Глюкоза венозной крови` are all glucose. Requiring the
 * catalogue entry to account for `крови` would leave every one of them uncoded, because the entry
 * is simply called `Глюкоза` — and these are among the most common ways a Russian lab prints the
 * line, so the rule would fail far more often than it fired.
 *
 * Kept deliberately narrow, and deliberately not extended to grading or fraction words. `общий`,
 * `прямой` and `непрямой` are *not* here and must not be added: `Билирубин прямой` is a different
 * analyte from `Билирубин общий`, and treating that qualifier as noise is the mis-filing this
 * module exists to prevent.
 */
const SPECIMEN_TOKENS = new Set([
  "кровь",
  "крови",
  "плазма",
  "плазмы",
  "сыворотка",
  "сыворотки",
  "сыворотке",
  "моча",
  "мочи",
  "моче",
  "слюна",
  "слюны",
  "кал",
  "кала",
  "ликвор",
  "ликвора",
  "венозная",
  "венозной",
  "капиллярная",
  "капиллярной",
  "цельной",
  "blood",
  "serum",
  "plasma",
  "urine",
]);

/**
 * Fold the Cyrillic letters that are visually identical to Latin ones onto their Latin twins.
 *
 * Applied to both sides of every comparison, so it never changes the meaning of a match — it only
 * stops a homoglyph from hiding one. This is not hypothetical: the catalogue spells vitamin B12 as
 * `Витамин B12 (кобаламин)` with a **Latin** B, and a Russian lab prints `Витамин В12` with a
 * **Cyrillic** В. The two strings look identical and share almost no trigrams, which scored the
 * token pair at 0.25 — indistinguishable from unrelated.
 */
function foldHomoglyphs(value: string): string {
  const cyrillic = "авекмнорстух";
  const latin = "abekmhopctyx";
  return value.replace(/[авекмнорстух]/g, (char) => latin[cyrillic.indexOf(char)] ?? char);
}

/**
 * Fold a free-text clinical name the way every match in this module folds it.
 *
 * Exported so that matching done elsewhere — the condition matcher in `resolution.ts` — folds
 * identically rather than approximately. A second, private copy would drift, and the drift would
 * show up as a condition that stops matching its analyte for reasons nobody can see: `Витамин В12`
 * with a Cyrillic В and `Витамин B12` with a Latin B look the same and share almost no characters.
 */
export function foldForMatch(value: string): string {
  return foldHomoglyphs(normalize(value));
}

function tokensOf(normalized: string): string[] {
  return normalized.split(" ").filter((token) => token.length > 0);
}

/** Every word this entry answers to: its names, its synonyms and its code. */
function vocabularyTokens<T>(view: CatalogView<T>): string[] {
  return [...view.names, ...view.synonyms, view.code].flatMap((entry) =>
    tokensOf(normalize(entry)),
  );
}

/**
 * True when some word of the entry's vocabulary is the same word as `token`.
 *
 * Trigram similarity rather than equality, because Russian inflects: the catalogue says
 * `Железо сывороточное` and the document says `Железо сыворотки`. Those score 0.61 against each
 * other, while genuinely different words that merely share a prefix — `холестерин` against
 * `холецистит` — score 0.36, so the threshold sits comfortably between them rather than being
 * tuned to a single example.
 */
function isTokenExplained(token: string, vocabulary: string[]): boolean {
  const folded = foldHomoglyphs(token);
  // A short token is an abbreviation, and abbreviations are not inflected -- they are chosen to be
  // distinct. `ЛПВП`, `ЛПНП` and `ЛПОНП` are three different lipid fractions separated by a single
  // letter, and trigram similarity rates them near-identical, so tolerating a near miss here files
  // one analyte's result into another analyte's history. Demand an exact match and let the longer
  // words carry the inflection tolerance, which is what actually needs it: `сыворотки` against
  // `сывороточное` is the same word, `лпонп` against `лпнп` is not.
  if (folded.length < ABBREVIATION_MAX_LENGTH) {
    return vocabulary.some((word) => foldHomoglyphs(word) === folded);
  }
  return vocabulary.some(
    (word) => similarity(folded, foldHomoglyphs(word)) >= TOKEN_MATCH_THRESHOLD,
  );
}

/**
 * True when the query contains a substantial word this candidate cannot account for anywhere.
 *
 * Trigram similarity over the whole string rewards a shared prefix and is indifferent to the token
 * that carries the meaning. `Холестерин ЛПОНП` — VLDL cholesterol — clears the threshold against
 * `cholesterol_total` on the strength of the long shared `холестерин` alone, while `ЛПОНП`, which
 * is the entire difference between the two analytes, contributes a handful of trigrams and is never
 * required to match anything. The result is one analyte's number written into a different analyte's
 * history, marked applied, so the chart picks it up.
 *
 * A candidate that cannot explain a word of the query has not matched the query, whatever its
 * trigram overlap says, so it is dropped from consideration rather than merely marked down.
 */
function hasUnexplainedToken<T>(normalizedQuery: string, view: CatalogView<T>): boolean {
  const queryTokens = tokensOf(normalizedQuery);
  if (queryTokens.length < 2) return false;
  const vocabulary = vocabularyTokens(view);
  return queryTokens.some(
    (token) =>
      token.length >= DISCRIMINATING_TOKEN_MIN_LENGTH &&
      !SPECIMEN_TOKENS.has(token) &&
      !isTokenExplained(token, vocabulary),
  );
}

/**
 * The one entry that answers to a word of this query, when exactly one does.
 *
 * Sits between whole-string synonym matching and fuzzy scoring, and exists because a printed label
 * is routinely a generic head plus a decisive qualifier: `Холестерин ЛПВП` is HDL cholesterol, and
 * the catalogue holds it under `ЛПВП (HDL-C)` with `лпвп` among its synonyms. Whole-string matching
 * misses that, and whole-string fuzzy scoring actively mis-files it, because `холестерин` outweighs
 * `лпвп` on trigram count and drags the line onto `cholesterol_total`.
 *
 * Requiring exactly one entry across the whole query is what makes this safe. A token several
 * entries answer to is not evidence for any of them and is ignored; a token no entry answers to —
 * `лпонп`, which the catalogue simply does not cover — leaves nothing to resolve, and the line
 * correctly stays uncoded rather than being forced onto its nearest neighbour.
 */
function resolveByDiscriminatingToken<T>(
  normalizedQuery: string,
  views: CatalogView<T>[],
  qualifiersChangeIdentity: boolean,
): CatalogView<T> | null {
  const queryTokens = tokensOf(normalizedQuery).filter(
    (token) => token.length >= DISCRIMINATING_TOKEN_MIN_LENGTH,
  );
  if (queryTokens.length < 2) return null;

  const matched = new Set<CatalogView<T>>();
  for (const token of queryTokens) {
    const folded = foldHomoglyphs(token);
    const hits = views.filter((view) =>
      [...view.names, ...view.synonyms].some(
        (entry) => foldHomoglyphs(normalize(entry)) === folded,
      ),
    );
    // A token half the catalogue answers to distinguishes nothing; only a unique owner is evidence.
    if (hits.length === 1) matched.add(hits[0]);
  }
  if (matched.size !== 1) return null;

  const winner = [...matched][0];
  if (!qualifiersChangeIdentity) return winner;

  // For an analyte, the winner still has to account for the rest of the label, because a qualifier
  // it cannot explain means a different analyte. Without this, a line resolves on its generic head
  // alone: `Холестерин ЛПОНП` would match `cholesterol_total` because `холестерин` is one of its
  // synonyms and `лпонп` belongs to nobody — the exact mis-filing this path exists to stop, reached
  // by another route. `Билирубин прямой` and `Билирубин непрямой` are the same story: both are
  // distinct analytes from `Билирубин общий`, and both must stay uncoded rather than be folded into
  // it. A qualifier the winner *can* explain is fine and common: `Железо сыворотки` against
  // `Железо сывороточное`, or `Витамин В12` against `Витамин B12 (кобаламин)`.
  return hasUnexplainedToken(normalizedQuery, winner) ? null : winner;
}

function resolveWithViews<T>(
  modelCode: string | null,
  nameText: string | null,
  views: CatalogView<T>[],
  qualifiersChangeIdentity: boolean,
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

  const byToken = resolveByDiscriminatingToken(normalizedName, views, qualifiersChangeIdentity);
  if (byToken) return { kind: "resolved", entry: byToken.entry, via: "synonym", score: 1 };

  let best: { view: CatalogView<T>; score: number } | null = null;
  for (const view of views) {
    if (hasUnexplainedToken(normalizedName, view)) continue;
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
    // An analyte label's qualifier decides which analyte it is. `Холестерин ЛПОНП`, `ЛПВП` and
    // `ЛПНП` are three different lipids and `Билирубин прямой` is not `Билирубин общий`, so a
    // qualifier the entry cannot account for means this is not that entry, and the row stays
    // uncoded rather than joining another analyte's history.
    true,
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
    // A finding label's qualifiers describe the same morphology rather than replacing it. A
    // `Хронический активный гастрит` is a gastritis is an inflammation; `хронический` and
    // `активный` say how much and how long, not what. Requiring the entry to account for them
    // would leave the finding uncoded for saying more about itself, which is backwards.
    false,
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
    // Anatomy reads like findings do: `верхний полюс правой почки` is still the kidney.
    false,
  );
}
