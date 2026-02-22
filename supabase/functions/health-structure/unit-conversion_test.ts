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
