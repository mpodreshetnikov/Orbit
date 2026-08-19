import { assertEquals } from "std/assert/assert-equals";
import {
  convertRefRangeToCanonical,
  convertToCanonical,
  convertValueWithConfig,
  evaluateFormula,
  getUnitConfig,
} from "./unit-conversion.ts";
import type { ObservationCatalogItem } from "./types.ts";

const catalogEntry: ObservationCatalogItem = {
  id: "obs-1",
  obs_code: "GLU",
  name_ru: "Глюкоза",
  name_en: "Glucose",
  canonical_unit: "mmol/L",
  synonyms_ru: [],
  synonyms_en: [],
  accepted_units: {
    "mg/dL": { factor_to_canonical: 0.0555 },
    "mmol/L": { factor_to_canonical: 1 },
    C: { formula_to_canonical: "(x - 32) * 5 / 9" },
  },
};

Deno.test("evaluateFormula handles valid, invalid and unsafe expressions", () => {
  assertEquals(evaluateFormula("(x - 32) * 5 / 9", 212), 100);
  assertEquals(evaluateFormula("x + 1", Number.NaN), null);
  assertEquals(evaluateFormula("Math.max(x, 1)", 2), null);
});

Deno.test("getUnitConfig returns null for empty unit and config for known unit", () => {
  assertEquals(getUnitConfig(catalogEntry, "mg/dL"), { factor_to_canonical: 0.0555 });
  assertEquals(getUnitConfig(catalogEntry, "unknown"), null);
  assertEquals(getUnitConfig(catalogEntry, null), null);
  assertEquals(getUnitConfig(null, "mg/dL"), null);
});

Deno.test("convertValueWithConfig applies factor and formula branches", () => {
  assertEquals(convertValueWithConfig(100, { factor_to_canonical: 0.0555 }), 5.55);
  assertEquals(convertValueWithConfig(212, { formula_to_canonical: "(x - 32) * 5 / 9" }), 100);
  assertEquals(convertValueWithConfig(10, {}), 10);
  assertEquals(convertValueWithConfig(null, { factor_to_canonical: 2 }), null);
});

Deno.test(
  "convertToCanonical keeps raw values without catalog and uses canonical unit with catalog",
  () => {
    assertEquals(convertToCanonical(10, "mg/dL", null), {
      value_canonical: 10,
      unit_canonical: "mg/dL",
    });

    assertEquals(convertToCanonical(100, "mg/dL", catalogEntry), {
      value_canonical: 5.55,
      unit_canonical: "mmol/L",
    });
  },
);

Deno.test(
  "convertRefRangeToCanonical converts both bounds and keeps values without catalog",
  () => {
    assertEquals(convertRefRangeToCanonical(70, 100, "mg/dL", catalogEntry), {
      ref_range_low_canonical: 3.8850000000000002,
      ref_range_high_canonical: 5.55,
    });

    assertEquals(convertRefRangeToCanonical(1, 2, "mg/dL", null), {
      ref_range_low_canonical: 1,
      ref_range_high_canonical: 2,
    });
  },
);

Deno.test("a printed Cyrillic unit finds the catalogue's Latin key", () => {
  const b12: ObservationCatalogItem = {
    id: "obs-b12",
    obs_code: "vitamin_b12",
    name_ru: "Витамин B12",
    name_en: "Vitamin B12",
    canonical_unit: "pmol/L",
    synonyms_ru: [],
    synonyms_en: [],
    accepted_units: { "pg/mL": { factor_to_canonical: 0.738 } },
  };

  // The defect in one line: `704 пг/мл` was stored as `704 pmol/L`. The lookup missed because the
  // catalogue is keyed in Latin, the value passed through unconverted, and the canonical unit was
  // stamped on anyway — so the number was 35% high and wearing a unit it was never converted into.
  assertEquals(convertToCanonical(704, "пг/мл", b12), {
    value_canonical: 519.552,
    unit_canonical: "pmol/L",
  });
  // Printed forms vary in ways that carry no meaning.
  assertEquals(convertToCanonical(704, "ПГ/МЛ", b12).value_canonical, 519.552);
  assertEquals(convertToCanonical(704, "пг / мл", b12).value_canonical, 519.552);
  // The Latin spelling the catalogue already accepted must keep working.
  assertEquals(convertToCanonical(704, "pg/mL", b12).value_canonical, 519.552);
  // A capitalisation the catalogue does not list is still the same unit.
  assertEquals(convertToCanonical(704, "pg/ml", b12).value_canonical, 519.552);
  // A unit that means something else is not converted, and not guessed at.
  assertEquals(convertToCanonical(704, "нг/мл", b12).value_canonical, 704);
});

Deno.test("a unit with nothing to convert is folded but not altered", () => {
  const hemoglobin: ObservationCatalogItem = {
    id: "obs-hb",
    obs_code: "hemoglobin",
    name_ru: "Гемоглобин",
    name_en: "Haemoglobin",
    canonical_unit: "g/L",
    synonyms_ru: [],
    synonyms_en: [],
    accepted_units: { "g/L": { factor_to_canonical: 1 }, "g/dL": { factor_to_canonical: 10 } },
  };
  assertEquals(convertToCanonical(140, "г/л", hemoglobin).value_canonical, 140);
  // The case the silent failure was hiding: `г/дл` is a tenfold difference, not a spelling.
  assertEquals(convertToCanonical(14, "г/дл", hemoglobin).value_canonical, 140);
});

Deno.test("a formula that cannot be evaluated keeps the value instead of deleting it", () => {
  const entry: ObservationCatalogItem = {
    id: "obs-hba1c",
    obs_code: "hba1c",
    name_ru: "HbA1c",
    name_en: "HbA1c",
    canonical_unit: "%",
    synonyms_ru: [],
    synonyms_en: [],
    accepted_units: {
      // The shape the catalogue actually shipped: a description of the conversion, not one the
      // arithmetic-only evaluator can run. It never fired before, because no Russian document ever
      // matched the Latin key; folding units makes it reachable, and returning null here would
      // store no value at all — strictly worse than the unconverted number.
      "mmol/mol": { formula_to_canonical: "percent = (mmol_per_mol * 0.09148) + 2.152" },
    },
  };
  assertEquals(convertToCanonical(42, "ммоль/моль", entry).value_canonical, 42);

  const fixed: ObservationCatalogItem = {
    ...entry,
    accepted_units: { "mmol/mol": { formula_to_canonical: "(x * 0.09148) + 2.152" } },
  };
  const converted = convertToCanonical(42, "ммоль/моль", fixed);
  assertEquals(Number(converted.value_canonical?.toFixed(5)), 5.99416);
  assertEquals(converted.unit_canonical, "%");
});

Deno.test("an unconverted value keeps the unit it was printed in", () => {
  const entry: ObservationCatalogItem = {
    id: "obs-hba1c",
    obs_code: "hba1c",
    name_ru: "HbA1c",
    name_en: "HbA1c",
    canonical_unit: "%",
    synonyms_ru: [],
    synonyms_en: [],
    accepted_units: {
      "mmol/mol": { formula_to_canonical: "percent = (mmol_per_mol * 0.09148) + 2.152" },
    },
  };
  // The whole point of this module: a number that did not move must not be relabelled as though it
  // had. Storing 42 as `42 %` is the same defect as storing `704 пг/мл` as `704 pmol/L` -- the
  // value is true, the unit is a lie, and nothing in the row shows the difference.
  assertEquals(convertToCanonical(42, "ммоль/моль", entry), {
    value_canonical: 42,
    unit_canonical: "ммоль/моль",
  });

  // Same rule when the catalogue simply does not list the printed unit at all.
  const hemoglobin: ObservationCatalogItem = {
    id: "obs-hb",
    obs_code: "hemoglobin",
    name_ru: "Гемоглобин",
    name_en: "Haemoglobin",
    canonical_unit: "g/L",
    synonyms_ru: [],
    synonyms_en: [],
    accepted_units: { "g/L": { factor_to_canonical: 1 } },
  };
  assertEquals(convertToCanonical(8.7, "ммоль/л", hemoglobin), {
    value_canonical: 8.7,
    unit_canonical: "ммоль/л",
  });
  // And a unit it does list still reaches canonical.
  assertEquals(convertToCanonical(140, "г/л", hemoglobin), {
    value_canonical: 140,
    unit_canonical: "g/L",
  });
});

Deno.test("a folded unit converts the reference range with the value", () => {
  const b12: ObservationCatalogItem = {
    id: "obs-b12",
    obs_code: "vitamin_b12",
    name_ru: "Витамин B12",
    name_en: "Vitamin B12",
    canonical_unit: "pmol/L",
    synonyms_ru: [],
    synonyms_en: [],
    accepted_units: { "pg/mL": { factor_to_canonical: 0.738 } },
  };
  // Both ends, or the value is judged against a range in a different unit.
  assertEquals(convertRefRangeToCanonical(200, 900, "пг/мл", b12), {
    ref_range_low_canonical: 147.6,
    ref_range_high_canonical: 664.2,
  });
});
