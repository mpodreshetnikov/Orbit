import type { MedRegimenStatus } from "@orbit-types/regimen";
import { AlertTriangle } from "lucide-react-native";
import { Badge } from "@/components/ui";
import type { StatusFilter } from "@/features/medications/list";
import { t } from "@/lib/i18n";
import { usePalette, type Palette } from "@/theme";

function capitalized(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function filterLabel(filter: StatusFilter): string {
  return filter === "all" ? t("medications.all") : t(`medications.status${capitalized(filter)}`);
}

/** The web `StatusBadge`'s tints, from the palette. Archived shares completed's slate. */
export function statusTint(
  status: MedRegimenStatus,
  palette: Palette,
): { textTone: keyof Palette; surface: string; border: string } {
  switch (status) {
    case "active":
      return {
        textTone: "activeText",
        surface: palette.activeSurface,
        border: palette.activeBorder,
      };
    case "paused":
      return {
        textTone: "warningText",
        surface: palette.pausedSurface,
        border: palette.pausedBorder,
      };
    default:
      return {
        textTone: "completedText",
        surface: palette.completedSurface,
        border: palette.completedBorder,
      };
  }
}

export function StatusBadge({ status }: { status: MedRegimenStatus }) {
  const palette = usePalette();
  return <Badge label={filterLabel(status)} {...statusTint(status, palette)} />;
}

export function LowStockBadge({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <Badge
      label={label}
      icon={AlertTriangle}
      textTone="warningText"
      border={palette.warningBorder}
    />
  );
}
