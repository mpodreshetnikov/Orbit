import { assertEquals } from "std/assert/assert-equals";
import {
  FUZZY_THRESHOLD,
  resolveBodySiteCode,
  resolveFindingTypeCode,
  resolveObservationCode,
  similarity,
} from "./code-resolution.ts";
import type {
  BodySiteCatalogItem,
  FindingTypeCatalogItem,
  ObservationCatalogItem,
} from "./types.ts";

const OBSERVATIONS: ObservationCatalogItem[] = [
  {
    id: "obs-1",
    obs_code: "hemoglobin",
    name_ru: "Гемоглобин",
    name_en: "Haemoglobin",
    canonical_unit: "g/L",
    synonyms_ru: ["гб", "hb"],
    synonyms_en: ["hemoglobin", "hgb"],
    accepted_units: {},
  },
  {
    id: "obs-2",
    obs_code: "ferritin",
    name_ru: "Ферритин",
    name_en: "Ferritin",
    canonical_unit: "ug/L",
    synonyms_ru: [],
    synonyms_en: [],
    accepted_units: {},
  },
];

const FINDINGS: FindingTypeCatalogItem[] = [
  {
    id: "ft-1",
    finding_code: "polyp",
    name_ru: "Полип",
    name_en: "Polyp",
    synonyms_ru: ["полипозное образование"],
    synonyms_en: ["polypoid lesion"],
  },
];

const SITES: BodySiteCatalogItem[] = [
  {
    id: "bs-1",
    site_code: "gallbladder",
    name_ru: "Желчный пузырь",
    name_en: "Gallbladder",
    parent_site_code: null,
    synonyms_ru: [],
    synonyms_en: [],
  },
];

Deno.test("similarity is 1 for identical strings and 0 for empty input", () => {
  assertEquals(similarity("ferritin", "ferritin"), 1);
  assertEquals(similarity("", "ferritin"), 0);
  assertEquals(similarity("ferritin", ""), 0);
});

Deno.test("similarity ignores case, punctuation and ё/е spelling", () => {
  assertEquals(similarity("Гемоглобин", "гемоглобин"), 1);
  assertEquals(similarity("Haemo-globin!", "haemo globin"), 1);
  assertEquals(similarity("Жёлчный пузырь", "Желчный пузырь"), 1);
});

Deno.test("resolveObservationCode prefers a genuine model code", () => {
  const result = resolveObservationCode("ferritin", "something else entirely", OBSERVATIONS);
  assertEquals(result.kind, "resolved");
  if (result.kind === "resolved") {
    assertEquals(result.entry.id, "obs-2");
    assertEquals(result.via, "code");
  }
});

Deno.test(
  "resolveObservationCode falls back to the printed label when the code is invented",
  () => {
    // This is the case that used to silently lose the value: model emits a plausible-looking code
    // that does not exist, exact lookup fails, row lands unapplied and vanishes from history.
    const result = resolveObservationCode("HGB_TOTAL", "Гемоглобин", OBSERVATIONS);
    assertEquals(result.kind, "resolved");
    if (result.kind === "resolved") {
      assertEquals(result.entry.obs_code, "hemoglobin");
      assertEquals(result.via, "name");
    }
  },
);

Deno.test("resolveObservationCode matches catalogue synonyms", () => {
  const result = resolveObservationCode(null, "HGB", OBSERVATIONS);
  assertEquals(result.kind, "resolved");
  if (result.kind === "resolved") {
    assertEquals(result.entry.obs_code, "hemoglobin");
    assertEquals(result.via, "synonym");
  }
});

Deno.test("resolveObservationCode tolerates inflection via fuzzy matching", () => {
  const result = resolveObservationCode(null, "гемоглобина", OBSERVATIONS);
  assertEquals(result.kind, "resolved");
  if (result.kind === "resolved") {
    assertEquals(result.entry.obs_code, "hemoglobin");
    assertEquals(result.via, "fuzzy");
    assertEquals(result.score >= FUZZY_THRESHOLD, true);
  }
});

Deno.test("resolveObservationCode refuses a merely related label", () => {
  // A wrong code is worse than no code: it attaches this value to another analyte's history.
  const result = resolveObservationCode(null, "Глюкоза", OBSERVATIONS);
  assertEquals(result.kind, "unresolved");
});

Deno.test("resolveObservationCode reports unresolved when there is nothing to match on", () => {
  const result = resolveObservationCode(null, null, OBSERVATIONS);
  assertEquals(result.kind, "unresolved");
  if (result.kind === "unresolved") assertEquals(result.reason, "no label");
});

Deno.test("resolveFindingTypeCode matches names and synonyms", () => {
  assertEquals(resolveFindingTypeCode(null, "полип", FINDINGS).kind, "resolved");
  assertEquals(resolveFindingTypeCode(null, "polypoid lesion", FINDINGS).kind, "resolved");
  assertEquals(resolveFindingTypeCode(null, "fracture", FINDINGS).kind, "unresolved");
});

Deno.test("resolveBodySiteCode matches a site by its printed label", () => {
  const result = resolveBodySiteCode("NOT_A_CODE", "желчный пузырь", SITES);
  assertEquals(result.kind, "resolved");
  if (result.kind === "resolved") assertEquals(result.entry.site_code, "gallbladder");
});

/**
 * The rest of this file works against small hand-written catalogues, which is right for behaviour
 * that does not depend on the real vocabulary. These do: the discriminating-token rules were
 * written against `Холестерин ЛПОНП` and `Витамин B12` as the production catalogue actually spells
 * them, and a toy fixture would let the rule pass while the real catalogue still mis-filed. The
 * corpus snapshot is the same data the eval scores against.
 */
const SNAPSHOT = JSON.parse(
  await Deno.readTextFile(
    new URL("../../../test/fixtures/extraction/shared/catalogs.json", import.meta.url),
  ),
) as {
  observationCatalog: ObservationCatalogItem[];
  findingTypeCatalog: FindingTypeCatalogItem[];
};

function observationCodeFor(label: string): string | null {
  const result = resolveObservationCode(null, label, SNAPSHOT.observationCatalog);
  return result.kind === "resolved" ? result.entry.obs_code : null;
}

function findingCodeFor(label: string): string | null {
  const result = resolveFindingTypeCode(null, label, SNAPSHOT.findingTypeCatalog);
  return result.kind === "resolved" ? result.entry.finding_code : null;
}

Deno.test("a lipid fraction the catalogue does not carry stays uncoded", () => {
  // The defect: `холестерин` alone cleared the fuzzy threshold against `cholesterol_total`, so a
  // VLDL result was written into total cholesterol's history and marked applied. There is no VLDL
  // entry, so the only correct answer is no code — the row is then invisible to the chart rather
  // than wrong in it.
  assertEquals(observationCodeFor("Холестерин ЛПОНП"), null);
  // Same shape, and the reason the fix cannot just be "reject anything with two words": these are
  // genuinely distinct analytes from total bilirubin, not spellings of it.
  assertEquals(observationCodeFor("Билирубин прямой"), null);
  assertEquals(observationCodeFor("Билирубин непрямой"), null);
});

Deno.test("labels that resolve today still resolve", () => {
  // The risk in tightening a matcher is silently losing the matches that already worked.
  assertEquals(observationCodeFor("Гемоглобин"), "hemoglobin");
  assertEquals(observationCodeFor("Глюкоза"), "glucose");
  assertEquals(observationCodeFor("Холестерин общий"), "cholesterol_total");
  assertEquals(observationCodeFor("Триглицериды"), "triglycerides");
  assertEquals(observationCodeFor("Креатинин"), "creatinine");
  assertEquals(observationCodeFor("Мочевина"), "urea");
  assertEquals(observationCodeFor("Билирубин общий"), "bilirubin_total");
  assertEquals(observationCodeFor("Гликированный гемоглобин"), "hba1c");
});

Deno.test("a homoglyph does not hide a match, and inflection does not either", () => {
  // The catalogue spells it `Витамин B12 (кобаламин)` with a Latin B; a Russian lab prints
  // `Витамин В12` with a Cyrillic В. The strings look identical and share almost no trigrams.
  assertEquals(observationCodeFor("Витамин В12"), "vitamin_b12");
  // Catalogue `Железо сывороточное`, document `Железо сыворотки` — same word, different case ending.
  assertEquals(observationCodeFor("Железо сыворотки"), "serum_iron");
});

Deno.test("a named inflammation resolves through its diagnosis, however qualified", () => {
  // `гастрит` and `Воспаление` share almost no trigrams; the link is semantic, so it lives in the
  // catalogue's synonyms rather than in any threshold.
  assertEquals(findingCodeFor("Гастрит"), "inflammation");
  assertEquals(findingCodeFor("Эзофагит"), "inflammation");
  // Qualifiers describe the same morphology rather than replacing it, unlike an analyte's.
  assertEquals(findingCodeFor("Хронический активный гастрит"), "inflammation");
  assertEquals(findingCodeFor("Хронический колит"), "inflammation");
});

Deno.test("a finding the catalogue does not carry still stays uncoded", () => {
  assertEquals(findingCodeFor("Аденома"), null);
});
