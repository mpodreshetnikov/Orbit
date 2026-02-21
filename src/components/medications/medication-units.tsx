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
import { medicationUnitKey, formatMedicationAmount, type MedicationUnit } from "@/types";

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

/** Format amount with unit for display: "1 pill", "2 pills". */
export function formatAmountWithUnit(
  amount: number,
  unit: MedicationUnit,
  t: (key: string, values?: { count?: number }) => string,
): string {
  const label = t(medicationUnitKey(unit), { count: amount });
  return formatMedicationAmount(amount, label);
}

/** Get translated unit label (category form for dropdowns/labels). */
export function getUnitLabel(
  unit: MedicationUnit,
  t: (key: string, values?: { count?: number }) => string,
): string {
  return t(medicationUnitKey(unit), { count: 2 });
}
