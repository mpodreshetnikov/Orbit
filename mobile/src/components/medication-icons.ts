import type { MedicationUnit } from "@orbit-types/medication";
import {
  Activity,
  AlertCircle,
  Ban,
  CheckCircle,
  CircleDot,
  Clock,
  Droplets,
  FlaskConical,
  Package,
  Pill,
  Scale,
  Square,
  Syringe,
  UtensilsCrossed,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react-native";
import type { DoseStatus } from "@/features/doses/model";
import type { Palette } from "@/theme";

/** The web app's unit icons (`src/components/medications/medication-units.tsx`), one for one. */
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

export function unitIcon(unit: MedicationUnit): LucideIcon {
  return UNIT_ICONS[unit] ?? Package;
}

/** A dose's state as the web dashboard marks it: a green check, a grey cross, an amber alert. */
export function statusIcon(status: DoseStatus): { icon: LucideIcon; tone: keyof Palette } {
  switch (status) {
    case "taken":
      return { icon: CheckCircle, tone: "success" };
    case "skipped":
      return { icon: X, tone: "mutedForeground" };
    case "missed":
      return { icon: AlertCircle, tone: "warning" };
    case "cancelled":
      return { icon: Ban, tone: "mutedForeground" };
    default:
      return { icon: Clock, tone: "mutedForeground" };
  }
}
