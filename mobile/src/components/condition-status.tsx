import type { ConditionStatus } from "@orbit-types/condition";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  History,
  type LucideIcon,
} from "lucide-react-native";
import { Badge, Icon } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { Palette } from "@/theme";

/** The web page's status colours: orange, yellow, green and grey. */
export const CONDITION_TONE: Record<ConditionStatus, keyof Palette> = {
  active: "rising",
  suspected: "warningText",
  resolved: "success",
  history: "mutedForeground",
};

const CONDITION_ICON: Record<ConditionStatus, LucideIcon> = {
  active: AlertCircle,
  suspected: HelpCircle,
  resolved: CheckCircle2,
  history: History,
};

export function ConditionStatusIcon({ status, size }: { status: ConditionStatus; size?: number }) {
  return <Icon icon={CONDITION_ICON[status]} size={size} tone={CONDITION_TONE[status]} />;
}

export function ConditionStatusBadge({ status }: { status: ConditionStatus }) {
  return <Badge label={t(`conditions.status.${status}`)} textTone={CONDITION_TONE[status]} />;
}
