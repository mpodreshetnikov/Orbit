import { MoreHorizontal } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { statusIcon, unitIcon } from "@/components/medication-icons";
import { Button, Icon, Text } from "@/components/ui";
import { clockTime, doseAmountLabel, doseUnit, isOpen, type DayDose } from "@/features/doses/model";
import { t } from "@/lib/i18n";
import { radius, space, usePalette } from "@/theme";

/** "Принято — 1 таблетка", "Пропущено", "Не принят", "Не указано — 1 таблетка". */
export function historyLabel(dose: DayDose): string {
  switch (dose.status) {
    case "taken":
      return `${t("medications.taken")} — ${doseAmountLabel(dose)}`;
    case "skipped":
      return t("medications.skipped");
    case "missed":
      return t("medications.missed");
    default:
      return `${t("medications.unspecified")} — ${doseAmountLabel(dose)}`;
  }
}

/**
 * One row of a course's intake history, as the web course page draws it: the unit, when, what
 * happened, the status mark, and a menu. A taken dose sits on green. `when` is the date and time on
 * the course screen and the time alone under a day heading in the full history.
 */
export function HistoryRow({
  dose,
  when,
  onMore,
}: {
  dose: DayDose;
  when: string;
  onMore: (dose: DayDose) => void;
}) {
  const palette = usePalette();
  const status = statusIcon(dose.status);
  return (
    <Pressable
      onLongPress={() => onMore(dose)}
      onPress={() => onMore(dose)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.sm,
        borderRadius: radius.sm,
        backgroundColor: pressed
          ? palette.muted
          : dose.status === "taken"
            ? palette.successSurface
            : "transparent",
      })}
    >
      <Icon icon={unitIcon(doseUnit(dose))} />
      <View style={{ flex: 1 }}>
        <Text size="sm" tabular>
          {when}
        </Text>
        <Text size="xs" tone={isOpen(dose.status) ? "warningText" : "mutedForeground"}>
          {historyLabel(dose)}
        </Text>
      </View>
      <Icon icon={status.icon} tone={status.tone} />
      <Button
        variant="ghost"
        compact
        icon={MoreHorizontal}
        accessibilityLabel={t("common.actions")}
        onPress={() => onMore(dose)}
      />
    </Pressable>
  );
}

/** When a history row happened: when it was taken where it was, else when it was due. */
export function doseMoment(dose: DayDose): Date {
  return new Date(dose.taken_at ?? dose.actual_at);
}

/** "21 окт., 09:00" — the course screen's short history. */
export function dateTimeLabel(dose: DayDose): string {
  const at = doseMoment(dose);
  return `${at.toLocaleDateString("ru", { day: "numeric", month: "short" })}, ${clockTime(at.toISOString())}`;
}
