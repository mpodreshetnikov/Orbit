import { useRouter, type Href } from "expo-router";
import { Plus, Settings } from "lucide-react-native";
import { ActionSheetIOS, Alert, Pressable, View } from "react-native";
import { Icon } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useOverdueInterval, useSaveOverdueInterval } from "@/lib/queries";
import { space } from "@/theme";

/**
 * The medications tab's bar buttons, the same over doses and courses. The gear is the web page's
 * settings dialog: how often an overdue dose is reminded about again, in the system's prompt. The plus
 * adds a course.
 */
export function MedicationsHeaderActions() {
  const router = useRouter();
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

  /** The web page's two add buttons as one: a one-off intake or a regular course. */
  const add = () => {
    const kinds = ["one_time", "regular"] as const;
    const options = [t("medications.oneTime"), t("medications.regular"), t("common.cancel")];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: t("medications.add"), options, cancelButtonIndex: options.length - 1 },
      (index) => {
        const kind = kinds[index];
        if (kind) router.push(`/medications/new?kind=${kind}` as Href);
      },
    );
  };

  return (
    <View style={{ flexDirection: "row", gap: space.lg }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("medications.settings")}
        hitSlop={space.sm}
        onPress={editInterval}
      >
        <Icon icon={Settings} size={22} tone="foreground" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("medications.add")}
        hitSlop={space.sm}
        onPress={add}
      >
        <Icon icon={Plus} size={24} tone="foreground" />
      </Pressable>
    </View>
  );
}
