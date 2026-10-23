import type { ObservationStatus } from "@orbit-types/medical-record";
import { ArrowDown, ArrowUp, Check } from "lucide-react-native";
import { Badge } from "@/components/ui";
import { statusTone } from "@/features/observations/format";
import { t } from "@/lib/i18n";

/** The web history's status badge: nothing for an unknown status. */
export function ObservationStatusBadge({ status }: { status: ObservationStatus | null }) {
  if (!status || status === "unknown") return null;
  const icon = status === "normal" ? Check : status.endsWith("low") ? ArrowDown : ArrowUp;
  return (
    <Badge icon={icon} label={t(`observations.status.${status}`)} textTone={statusTone(status)} />
  );
}
