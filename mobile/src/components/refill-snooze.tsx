import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { View } from "react-native";
import { Button, Text } from "@/components/ui";
import { noonOf } from "@/features/medications/form";
import { t } from "@/lib/i18n";
import { dayKey, useRefillSnooze, useSetRefillSnooze } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/**
 * The web course page's low-stock box: put the reminder about running out off until a day, when a
 * delivery is already on its way, or bring it back. A day already past no longer counts as put off.
 * The date is the system's compact picker, which opens its calendar in place.
 */
export function RefillSnooze({ regimenId }: { regimenId: string }) {
  const palette = usePalette();
  const snooze = useRefillSnooze(regimenId);
  const save = useSetRefillSnooze();
  const today = dayKey(new Date());
  const active = snooze.data && snooze.data >= today ? snooze.data : null;
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? active ?? today;

  return (
    <View
      style={{
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.warningBorder,
        backgroundColor: palette.warningSurface,
      }}
    >
      <Text size="sm" tone="mutedForeground">
        {active
          ? `${t("medications.refillReminderSnoozedUntil")}: ${noonOf(active).toLocaleDateString(
              "ru",
              { day: "numeric", month: "short", year: "numeric" },
            )}`
          : t("medications.refillReminderSnoozeDescription")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        <DateTimePicker
          testID="refill-snooze-date"
          accessibilityLabel={t("medications.selectRefillReminderSnoozeDate")}
          value={noonOf(day)}
          mode="date"
          display="compact"
          locale="ru"
          minimumDate={noonOf(today)}
          onValueChange={(_event, date) => setPicked(dayKey(date))}
        />
        <Button
          compact
          label={t("medications.saveRefillReminderSnooze")}
          busy={save.isPending}
          onPress={() =>
            save.mutate({ regimenId, until: day }, { onSuccess: () => setPicked(null) })
          }
        />
        {active ? (
          <Button
            compact
            variant="ghost"
            label={t("medications.clearRefillReminderSnooze")}
            disabled={save.isPending}
            onPress={() => save.mutate({ regimenId, until: null })}
          />
        ) : null}
      </View>
    </View>
  );
}
