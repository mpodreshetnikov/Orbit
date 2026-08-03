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
