import type { FindingLaterality, FindingSeverity } from "@orbit-types/finding";
import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { Palette } from "@/theme";

const SEVERITY_TONE: Record<FindingSeverity, keyof Palette> = {
  mild: "warningText",
  moderate: "rising",
  severe: "destructive",
  unknown: "mutedForeground",
};

/** The web finding card's severity badge, tinted as there. */
export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <Badge
      label={t(`findings.severityOptions.${severity}`)}
      textTone={SEVERITY_TONE[severity] ?? "mutedForeground"}
    />
  );
}

/** The green "Устранена" badge. */
export function ResolvedBadge() {
  return <Badge label={t("findings.resolved")} textTone="success" />;
}

/** "Слева", "Справа", "Двусторонняя"; nothing for no side. */
export function lateralityText(laterality: FindingLaterality): string | null {
  return laterality === "none" ? null : t(`findings.lateralityOptions.${laterality}`);
}
