import { Settings } from "lucide-react-native";
import { Alert, Pressable } from "react-native";
import { Icon } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useOverdueInterval, useSaveOverdueInterval } from "@/lib/queries";
import { space } from "@/theme";

/**
 * The medications tab's bar button, the same over doses and courses. The gear is the web page's
 * settings dialog: how often an overdue dose is reminded about again, in the system's prompt.
 */
export function MedicationsHeaderActions() {
  const interval = useOverdueInterval();
  const saveInterval = useSaveOverdueInterval();

  const editInterval = () =>
    Alert.prompt(
      t("medications.overdueReminderInterval"),
      `${t("medications.overdueReminderIntervalDescription")}\n(${t("medications.overdueReminderIntervalMinutes")})`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.save"),
          onPress: (typed?: string) => {
            const minutes = Number((typed ?? "").trim());
            if (Number.isFinite(minutes) && minutes > 0) saveInterval.mutate(minutes);
          },
        },
      ],
      "plain-text",
      String(interval.data ?? ""),
      "number-pad",
    );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("medications.settings")}
      hitSlop={space.sm}
      onPress={editInterval}
    >
      <Icon icon={Settings} size={22} tone="foreground" />
    </Pressable>
  );
}
