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
  return catalogEntry.accepted_units?.[unit] ?? null;
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
    return evaluateFormula(config.formula_to_canonical, valueNumeric);
  }

  return valueNumeric;
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
  const valueCanonical = convertValueWithConfig(valueNumeric, config);
  return {
    value_canonical: valueCanonical,
    unit_canonical: catalogEntry.canonical_unit,
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
