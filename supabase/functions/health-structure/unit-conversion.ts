import type { ObservationCatalogItem } from "./types.ts";

interface UnitConfig {
  factor_to_canonical?: number;
  formula_to_canonical?: string;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSafeFormula(formula: string): boolean {
  return /^[0-9xX+\-*/().\s]+$/.test(formula);
}

/**
 * Printed unit strings, folded onto the Latin spellings the catalogue is keyed on.
 *
 * `accepted_units` is an exact string map, and every key in it is Latin (`mg/dL`, `pg/mL`, `g/L`).
 * The extraction stage asks the model for the unit "exactly as printed, in the document's own
 * language", so a Russian report supplies `пг/мл`, `ммоль/л`, `г/л`. Those never matched, and the
 * miss was silent and directional: `convertValueWithConfig` returned the value unconverted while
 * `convertToCanonical` stamped the catalogue's canonical unit on it anyway. For `ммоль/л` that is
 * harmless, because it *is* `mmol/L`. For vitamin B12 the factor is 0.738, so `704 пг/мл` was
 * stored as `704 pmol/L` — 35% high, and wearing a unit it was never converted into. The same
 * relabelling was applied to both ends of the reference range, so the value was wrong and the range
 * it gets judged against was wrong with it.
 *
 * Normalising here rather than adding Cyrillic keys to the catalogue: one map covers all
 * thirty-eight observation entries including ones added later, where Cyrillic keys would have to be
 * added to each new entry with no failure signal when someone forgets.
 *
 * Keys are lower-cased with whitespace removed (see `foldUnit`). Only unambiguous equivalences
 * belong here — a wrong unit is worse than an unconverted one, and an unrecognised unit already
 * falls through to the safe path of passing the value along untouched.
 */
const UNIT_ALIASES: Record<string, string> = {
  "г/л": "g/L",
  "г/дл": "g/dL",
  "мг/л": "mg/L",
  "мг/дл": "mg/dL",
  "мкг/л": "ug/L",
  "мкг/дл": "ug/dL",
  "пг/мл": "pg/mL",
  "нг/мл": "ng/mL",
  "ммоль/л": "mmol/L",
  "мкмоль/л": "umol/L",
  "нмоль/л": "nmol/L",
  "пмоль/л": "pmol/L",
  "ммоль/моль": "mmol/mol",
  "ед/л": "U/L",
  "е/л": "U/L",
  "u/л": "U/L",
  "мме/л": "mIU/L",
  "ммє/л": "mIU/L",
  "мед/л": "mIU/L",
  пг: "pg",
  фл: "fL",
  мм: "mm",
  "мм/ч": "mm/h",
  "ммрт.ст.": "mmHg",
  ммртст: "mmHg",
  сек: "s",
  с: "s",
};

/**
 * Fold a printed unit to a comparison key: lower case, no whitespace, `ё` as `е`.
 *
 * Printed forms vary in ways that carry no meaning — `Г/Л`, `г / л`, `ммоль / л` — and none of
 * that should decide whether a conversion fires.
 */
function foldUnit(unit: string): string {
  return unit.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");
}

/**
 * The catalogue's own spelling of a printed unit, or null when it lists nothing equivalent.
 *
 * Three tiers, narrowing: the exact string the catalogue already accepts; the Latin form this
 * module knows the printed one to mean; and finally a fold-insensitive comparison against the
 * entry's own keys, which is what lets `mg/dl` find `mg/dL` without an alias entry for every
 * capitalisation a lab might print. Matching stays exact within each tier — there is no fuzziness
 * anywhere in this path, by design.
 */
export function resolveAcceptedUnitKey(
  acceptedUnits: Record<string, unknown> | null | undefined,
  unit: string,
): string | null {
  if (!acceptedUnits) return null;
  if (unit in acceptedUnits) return unit;

  const folded = foldUnit(unit);
  const alias = UNIT_ALIASES[folded];
  if (alias && alias in acceptedUnits) return alias;

  for (const key of Object.keys(acceptedUnits)) {
    if (foldUnit(key) === folded) return key;
    if (alias && foldUnit(key) === foldUnit(alias)) return key;
  }
  return null;
}

export function evaluateFormula(formula: string, inputValue: number): number | null {
  if (!Number.isFinite(inputValue)) return null;
  if (!isSafeFormula(formula)) return null;

  try {
    const expression = formula.replace(/\bx\b/gi, `(${inputValue})`);
    const result = Function(`"use strict"; return (${expression});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

export function getUnitConfig(
  catalogEntry: ObservationCatalogItem | null,
  unitInput: string | null,
): UnitConfig | null {
  if (!catalogEntry) return null;
  const unit = normalizeText(unitInput);
  if (!unit) return null;
  const key = resolveAcceptedUnitKey(catalogEntry.accepted_units, unit);
  return key === null ? null : (catalogEntry.accepted_units?.[key] ?? null);
}

export function convertValueWithConfig(
  valueNumeric: number | null,
  config: UnitConfig | null,
): number | null {
  if (valueNumeric === null || !Number.isFinite(valueNumeric)) return null;
  if (!config) return valueNumeric;

  if (
    typeof config.factor_to_canonical === "number" &&
    Number.isFinite(config.factor_to_canonical)
  ) {
    return valueNumeric * config.factor_to_canonical;
  }

  if (typeof config.formula_to_canonical === "string" && config.formula_to_canonical.trim()) {
    // A formula this module refuses to evaluate — prose rather than an expression, or anything
    // outside the arithmetic whitelist — must not delete the measurement. Returning null here
    // would store no value at all, which is strictly worse than the unconverted number and is
    // reachable now that Cyrillic units find their catalogue entry: `hba1c` shipped with
    // `"percent = (mmol_per_mol * 0.09148) + 2.152"`, which is a description of the conversion and
    // not a computable one. Fall back to the same pass-through used when no config matches.
    return evaluateFormula(config.formula_to_canonical, valueNumeric) ?? valueNumeric;
  }

  return valueNumeric;
}

/**
 * Convert, and say whether a conversion actually happened.
 *
 * The caller needs both halves. A value that was not converted has not reached the canonical unit,
 * and labelling it as though it had is the defect this module was fixed for: `704 пг/мл` stored as
 * `704 pmol/L` is wrong in exactly the way a reader cannot see. `convertValueWithConfig` alone
 * cannot report this, because passing the value through unchanged is both what a 1:1 conversion
 * does and what no conversion at all does.
 */
function convertWithOutcome(
  valueNumeric: number | null,
  config: UnitConfig | null,
): { value: number | null; converted: boolean } {
  if (!config) return { value: convertValueWithConfig(valueNumeric, config), converted: false };

  if (
    typeof config.factor_to_canonical === "number" &&
    Number.isFinite(config.factor_to_canonical)
  ) {
    return { value: convertValueWithConfig(valueNumeric, config), converted: true };
  }

  if (typeof config.formula_to_canonical === "string" && config.formula_to_canonical.trim()) {
    const evaluated =
      valueNumeric === null || !Number.isFinite(valueNumeric)
        ? null
        : evaluateFormula(config.formula_to_canonical, valueNumeric);
    // An unevaluable formula keeps the number, and therefore keeps the printed unit with it.
    if (evaluated === null) return { value: valueNumeric, converted: false };
    return { value: evaluated, converted: true };
  }

  // A config naming neither a factor nor a formula converts nothing.
  return { value: convertValueWithConfig(valueNumeric, config), converted: false };
}

export function convertToCanonical(
  valueNumeric: number | null,
  unitInput: string | null,
  catalogEntry: ObservationCatalogItem | null,
): { value_canonical: number | null; unit_canonical: string | null } {
  if (!catalogEntry) {
    return {
      value_canonical: valueNumeric,
      unit_canonical: normalizeText(unitInput),
    };
  }

  const config = getUnitConfig(catalogEntry, unitInput);
  const outcome = convertWithOutcome(valueNumeric, config);
  return {
    value_canonical: outcome.value,
    // Only claim the canonical unit when the value actually reached it. Stamping it regardless is
    // how `704 пг/мл` became `704 pmol/L`: the number never moved, the label said it had, and
    // nothing in the row disclosed the difference. When no conversion applied, the printed unit is
    // the honest answer — the value is still true, it is simply not canonical.
    unit_canonical: outcome.converted ? catalogEntry.canonical_unit : normalizeText(unitInput),
  };
}

export function convertRefRangeToCanonical(
  refRangeLow: number | null,
  refRangeHigh: number | null,
  unitInput: string | null,
  catalogEntry: ObservationCatalogItem | null,
): { ref_range_low_canonical: number | null; ref_range_high_canonical: number | null } {
  if (!catalogEntry) {
    return {
      ref_range_low_canonical: refRangeLow,
      ref_range_high_canonical: refRangeHigh,
    };
  }

  const config = getUnitConfig(catalogEntry, unitInput);
  return {
    ref_range_low_canonical: convertValueWithConfig(refRangeLow, config),
    ref_range_high_canonical: convertValueWithConfig(refRangeHigh, config),
  };
}
