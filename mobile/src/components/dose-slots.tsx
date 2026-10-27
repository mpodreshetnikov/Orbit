import { Check, Clock, MoreHorizontal, X } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { statusIcon, unitIcon } from "@/components/medication-icons";
import { Button, Icon, Text } from "@/components/ui";
import type { Slot } from "@/features/doses/dashboard";
import { doseAmountLabel, doseName, doseUnit, isOpen, type DayDose } from "@/features/doses/model";
import { intakeAdviceLabel } from "@/features/medications/format";
import { t } from "@/lib/i18n";
import type { DoseAction } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** The web medication dashboard's time slots, shared by the medications tab and "Сегодня". */
function SlotTime({ time }: { time: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Icon icon={Clock} size={14} />
      <Text size="xs" weight="medium" tone="mutedForeground" tabular>
        {time}
      </Text>
    </View>
  );
}

export function PendingSlot({
  slot,
  actionable,
  overdueIds,
  recentlyActed,
  onAct,
  onOpen,
}: {
  slot: Slot;
  actionable: boolean;
  overdueIds: ReadonlySet<string>;
  recentlyActed: ReadonlySet<string>;
  onAct: (dose: DayDose, action: DoseAction) => void;
  onOpen: (dose: DayDose) => void;
}) {
  const palette = usePalette();
  const open = slot.doses.filter((dose) => isOpen(dose.status) || dose.status === "missed");
  return (
    <View style={{ backgroundColor: palette.card, borderRadius: radius.lg, gap: 6 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.xs,
        }}
      >
        <SlotTime time={slot.time} />
        {actionable && open.length > 1 ? (
          <Button
            variant="secondary"
            compact
            icon={Check}
            label={t("medications.confirmAll")}
            onPress={() => open.forEach((dose) => onAct(dose, "take"))}
          />
        ) : null}
      </View>
      {slot.doses.map((dose) => {
        const justActed = recentlyActed.has(dose.id);
        const overdue = overdueIds.has(dose.id);
        const taken = dose.status === "taken";
        const advice = intakeAdviceLabel(dose.regimen);
        const settledLabel =
          dose.status === "taken"
            ? `${t("medications.taken")} — ${doseAmountLabel(dose)}`
            : dose.status === "skipped"
              ? t("medications.skipped")
              : null;
        const status = statusIcon(dose.status);
        return (
          <View
            key={dose.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingVertical: 6,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              borderWidth: overdue || (taken && justActed) ? 1 : 0,
              borderColor: overdue ? palette.warningBorder : palette.successBorder,
              backgroundColor: overdue
                ? palette.warningSurface
                : taken && justActed
                  ? palette.successSurface
                  : palette.mutedHalf,
            }}
          >
            <Icon icon={unitIcon(doseUnit(dose))} />
            <Pressable style={{ flex: 1 }} onPress={() => onOpen(dose)} accessibilityRole="link">
              <Text size="sm" weight="medium" numberOfLines={1}>
                {doseName(dose)}
              </Text>
              <Text size="xs" tone="mutedForeground">
                {overdue && !justActed ? (
                  <Text size="xs" weight="medium" tone="warning">
                    {t("medications.overdue")} ·{" "}
                  </Text>
                ) : null}
                {justActed && settledLabel ? settledLabel : doseAmountLabel(dose)}
                {advice ? ` · ${advice}` : ""}
              </Text>
            </Pressable>
            {actionable && !justActed ? (
              <View style={{ flexDirection: "row", gap: space.xs }}>
                <Button
                  variant="ghost"
                  compact
                  icon={X}
                  accessibilityLabel={t("medications.skipped")}
                  onPress={() => onAct(dose, "skip")}
                />
                <Button
                  compact
                  icon={Check}
                  label={t("medications.taken")}
                  onPress={() => onAct(dose, "take")}
                />
              </View>
            ) : null}
            {justActed ? <Icon icon={status.icon} tone={status.tone} /> : null}
          </View>
        );
      })}
    </View>
  );
}

export function CompletedSlot({
  slot,
  onMore,
  onOpen,
}: {
  slot: Slot;
  onMore: (dose: DayDose) => void;
  onOpen: (dose: DayDose) => void;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: palette.border,
        backgroundColor: palette.mutedHalf,
      }}
    >
      <View style={{ paddingHorizontal: space.md, paddingVertical: 6 }}>
        <SlotTime time={slot.time} />
      </View>
      {slot.doses.map((dose) => {
        const status = statusIcon(dose.status);
        const advice = intakeAdviceLabel(dose.regimen);
        const label =
          dose.status === "taken"
            ? `${t("medications.taken")} — ${doseAmountLabel(dose)}`
            : dose.status === "skipped"
              ? t("medications.skipped")
              : t("medications.unspecified");
        return (
          <Pressable
            key={dose.id}
            onPress={() => onOpen(dose)}
            onLongPress={() => onMore(dose)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: 6,
              backgroundColor: pressed
                ? palette.muted
                : dose.status === "taken"
                  ? palette.successSurface
                  : "transparent",
            })}
          >
            <Icon icon={unitIcon(doseUnit(dose))} />
            <View style={{ flex: 1 }}>
              <Text size="sm" weight="medium" numberOfLines={1}>
                {doseName(dose)}
              </Text>
              <Text size="xs" tone="mutedForeground">
                {label}
                {advice ? ` · ${advice}` : ""}
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
      })}
    </View>
  );
}
