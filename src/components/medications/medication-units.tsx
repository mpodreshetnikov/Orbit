"use client";

import {
  Activity,
  CircleDot,
  Droplets,
  FlaskConical,
  Package,
  Pill,
  Scale,
  Square,
  Syringe,
  UtensilsCrossed,
  Wind,
  type LucideIcon,
} from "lucide-react";
import {
  medicationUnitKey,
  formatMedicationAmount,
  type MedicationUnit,
} from "@/types";

const UNIT_ICONS: Record<MedicationUnit, LucideIcon> = {
  pill: Pill,
  capsule: Pill,
  ml: Droplets,
  drops: Droplets,
  milligram: Pill,
  gram: Scale,
  iu: Activity,
  ampoule: FlaskConical,
  injection: Syringe,
  inhalation: Wind,
  patch: Square,
  application: CircleDot,
  spray: Wind,
  portion: CircleDot,
  tablespoon: UtensilsCrossed,
  teaspoon: UtensilsCrossed,
  unit: Package,
  suppository: Pill,
  other: Package,
};

export function getUnitIcon(unit: MedicationUnit): LucideIcon {
  return UNIT_ICONS[unit] ?? Package;
}

/** Format amount with unit for display: "1 ml", "2 pills". */
export function formatAmountWithUnit(
  amount: number,
  unit: MedicationUnit,
  t: (key: string) => string
): string {
  const label = t(medicationUnitKey(unit));
  return formatMedicationAmount(amount, label);
}

/** Get translated unit label. */
export function getUnitLabel(
  unit: MedicationUnit,
  t: (key: string) => string
): string {
  return t(medicationUnitKey(unit));
}
