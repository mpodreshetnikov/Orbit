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
  if (result.kind === "resolved") {
    assertEquals(result.entry.site_code, "gallbladder");
  }
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

Deno.test("a word naming the specimen does not stop an analyte resolving", () => {
  // `Глюкоза крови`, `Глюкоза плазмы` and `Глюкоза венозной крови` are all glucose, and are among
  // the most common ways a Russian lab prints the line. A rule that required the catalogue entry to
  // account for `крови` would leave all of them uncoded and would fire far more often than it
  // helped.
  assertEquals(observationCodeFor("Глюкоза крови"), "glucose");
  assertEquals(observationCodeFor("Глюкоза плазмы"), "glucose");
  assertEquals(observationCodeFor("Глюкоза венозной крови"), "glucose");
  assertEquals(observationCodeFor("Гемоглобин крови"), "hemoglobin");
  assertEquals(observationCodeFor("Железо сыворотки крови"), "serum_iron");

  // The exemption covers specimens only. A fraction or a grade still changes which analyte it is,
  // and folding those in would undo the whole point.
  assertEquals(observationCodeFor("Холестерин ЛПОНП"), null);
  assertEquals(observationCodeFor("Билирубин прямой"), null);
});

Deno.test("a lipid fraction resolves to its own analyte, and VLDL still to none", () => {
  // A Russian panel prints `Холестерин ЛПВП`, while the catalogue carries the bare abbreviation.
  // No algorithm can bridge that: `холестерин` names exactly one entry and `лпвп` names exactly one
  // other, so neither is measurably the more decisive token. The printed forms are catalogue data.
  assertEquals(observationCodeFor("Холестерин ЛПВП"), "hdl_c");
  assertEquals(observationCodeFor("Холестерин ЛПНП"), "ldl_c");
  assertEquals(observationCodeFor("ХС ЛПНП"), "ldl_c");
  assertEquals(observationCodeFor("ЛПВП"), "hdl_c");

  // And the reason those synonyms are dangerous to add carelessly: `лпонп` is one letter from
  // `лпнп`, so a near-miss match would file VLDL into LDL's history. The catalogue has no VLDL
  // entry, so the only correct answer is still no code.
  assertEquals(observationCodeFor("Холестерин ЛПОНП"), null);
});

Deno.test("a lab's own abbreviation in parentheses names the analyte", () => {
  // On 2026-10-26 a lab printed every line as `Full name (ABBR)` and these stayed uncoded: the
  // catalogue answers to the abbreviation exactly, but the long name's words were held against it.
  assertEquals(observationCodeFor("Аланинаминотрансфераза (АЛТ)"), "alt");
  assertEquals(observationCodeFor("Аспартатаминотрансфераза (АСТ)"), "ast");
  assertEquals(observationCodeFor("Средний объем эритроцитов (MCV)"), "mcv");
  // The other way round, and with the abbreviation typed in Cyrillic.
  assertEquals(observationCodeFor("MCH (среднее содержание гемоглобина в эритроците)"), "mch");
  assertEquals(observationCodeFor("Среднее содержание гемоглобина в эритроците (МСН)"), "mch");
  assertEquals(observationCodeFor("МСН"), "mch");
  // A parenthesised word that names nothing proves nothing, and a fraction still stays uncoded.
  assertEquals(observationCodeFor("Холестерин (ЛПОНП)"), null);
  assertEquals(observationCodeFor("Билирубин (прямой)"), null);
});

Deno.test("vitamin D printed with a Cyrillic Д resolves", () => {
  assertEquals(observationCodeFor("Витамин Д"), "vitamin_d_25oh");
  assertEquals(observationCodeFor("витамин д"), "vitamin_d_25oh");
});

function entry(
  obs_code: string,
  name_ru: string,
  canonical_unit: string,
  synonyms: string[],
  accepted_units: ObservationCatalogItem["accepted_units"] = {},
): ObservationCatalogItem {
  return {
    id: obs_code,
    obs_code,
    name_ru,
    name_en: name_ru,
    canonical_unit,
    synonyms_ru: synonyms,
    synonyms_en: [],
    accepted_units,
  };
}

Deno.test("an abbreviation does not override a long name that names another analyte", () => {
  const catalog = [
    entry("bilirubin_total", "Билирубин общий", "umol/L", ["bil"]),
    entry("bilirubin_direct", "Билирубин прямой", "umol/L", []),
  ];
  // The two parts disagree, so the label is ambiguous and stays uncoded; above all it is not
  // filed into total bilirubin on the strength of `bil`.
  const result = resolveObservationCode(null, "Билирубин прямой (BIL)", catalog);
  assertEquals(result.kind, "unresolved");
  // Nor when extra wording keeps the long part from naming anything outright: `прямой` is still
  // direct bilirubin's word.
  assertEquals(
    resolveObservationCode(null, "Билирубин прямой в сыворотке (BIL)", catalog).kind,
    "unresolved",
  );
  assertEquals(
    resolveObservationCode(null, "Билирубин в сыворотке (BIL)", catalog).kind,
    "resolved",
  );
});

Deno.test("the printed unit picks between entries the label names", () => {
  // The defect: PDW printed in fL was filed into the PDW kept in %, where 16.1 fL reads as 16.1 %.
  const catalog = [
    entry("pdw_pct", "PDW", "%", ["pdw"], { "%": { factor_to_canonical: 1 } }),
    entry("pdw", "PDW (fL)", "fL", ["pdw"], { fL: { factor_to_canonical: 1 } }),
    entry("albumin", "Альбумин", "g/L", ["альбумин"]),
  ];
  const codeFor = (label: string, unit: string | null) => {
    const result = resolveObservationCode(null, label, catalog, unit);
    return result.kind === "resolved" ? result.entry.obs_code : null;
  };
  assertEquals(codeFor("PDW", "fL"), "pdw");
  assertEquals(codeFor("PDW", "фл"), "pdw");
  assertEquals(codeFor("PDW", "%"), "pdw_pct");
  assertEquals(codeFor("PDW", null), "pdw_pct");
  // An unfamiliar spelling proves nothing, and an entry's own unit fits with no conversion listed.
  assertEquals(codeFor("PDW", "ед."), "pdw_pct");
  assertEquals(codeFor("Альбумин", "г/л"), "albumin");

  // A known unit no entry takes leaves the row unmatched, naming the entry it ruled out.
  const mismatch = resolveObservationCode(null, "Альбумин", catalog, "г/дл");
  assertEquals(mismatch.kind, "unresolved");
  if (mismatch.kind === "unresolved") {
    assertEquals(mismatch.unitMismatch?.obs_code, "albumin");
  }
});
