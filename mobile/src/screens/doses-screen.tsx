import { Stack, useRouter, type Href } from "expo-router";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { CompletedSlot, PendingSlot } from "@/components/dose-slots";
import { showDoseSheet } from "@/components/dose-sheet";
import { MedicationsHeaderActions } from "@/components/medications-header";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { buildDashboard } from "@/features/doses/dashboard";
import { useToday } from "@/features/doses/use-today";
import type { DayDose } from "@/features/doses/model";
import { t } from "@/lib/i18n";
import { useDayDoses, useDoseAction, usePerson } from "@/lib/queries";
import { useSettledDoses } from "@/features/doses/use-settled";
import { radius, space, usePalette } from "@/theme";

function shiftDay(day: Date, by: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + by);
}

/**
 * The day's doses — the web app's medication dashboard, on the phone, under the medications tab.
 *
 * Doses still to take sit at the top in time slots, overdue ones tinted amber, each with "Принято" and
 * a skip cross; a tap answers at once, with a haptic, and the server is told behind it. The day's
 * settled doses fold away below. Arrows step through days, so the past can be corrected and the
 * coming days read; a future day shows its plan but takes no answers, as on the web. `top` is the
 * tab's switch between doses and courses, scrolled with the list.
 */
export default function DosesScreen({ top }: { top?: ReactNode }) {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const today = useToday();
  const [offset, setOffset] = useState(0);
  const day = shiftDay(today, offset);
  const doses = useDayDoses(person.data?.id, day);
  const action = useDoseAction();
  const { recentlyActed, act } = useSettledDoses(action);
  const [completedOpen, setCompletedOpen] = useState(false);

  const isToday = offset === 0;
  const isFuture = offset > 0;
  const actionable = !isFuture;
  const dashboard = useMemo(
    () => buildDashboard(doses.data ?? [], { now: new Date(), isToday, recentlyActed }),
    [doses.data, isToday, recentlyActed],
  );

  const openCourse = useCallback(
    (dose: DayDose) => router.push(`/medications/${dose.regimen_id}` as Href),
    [router],
  );

  const offerActions = useCallback(
    (dose: DayDose) =>
      showDoseSheet(dose, act, {
        actionable,
        extra: [{ label: t("medications.navTitle"), run: () => openCourse(dose) }],
      }),
    [act, actionable, openCourse],
  );

  const dateLabel = day.toLocaleDateString("ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const sectionTitle = isToday
    ? t("medications.todayIntakes")
    : t("medications.intakesForDate", { date: dateLabel });
  const showCompleted = completedOpen || offset < 0;

  const header = (
    <Stack.Screen
      options={{
        title: t("medications.navTitle"),
        headerRight: () => <MedicationsHeaderActions />,
        headerSearchBarOptions: undefined,
      }}
    />
  );

  if (person.error || doses.error) {
    const message = (person.error ?? doses.error)?.message ?? t("common.error");
    return (
      <>
        {header}
        <Placeholder
          message={message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : doses.refetch())}
            />
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={doses.isRefetching}
            onRefresh={() => void doses.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        {top}
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text size="sm" weight="medium" tone="mutedForeground" style={{ flex: 1 }}>
              {person.data ? `${sectionTitle} · ${person.data.name}` : sectionTitle}
            </Text>
            {!isToday ? (
              <Button
                variant="ghost"
                compact
                label={t("medications.dateToday")}
                onPress={() => setOffset(0)}
              />
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Button
              variant="outline"
              icon={ChevronLeft}
              accessibilityLabel={t("medications.datePrev")}
              onPress={() => setOffset((value) => value - 1)}
              style={{ width: 36, minHeight: 36 }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setOffset(0)}
              style={{
                flex: 1,
                minHeight: 36,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: radius.md,
              }}
            >
              <Text size="sm" weight="medium" tabular>
                {dateLabel}
              </Text>
            </Pressable>
            <Button
              variant="outline"
              icon={ChevronRight}
              accessibilityLabel={t("medications.dateNext")}
              onPress={() => setOffset((value) => value + 1)}
              style={{ width: 36, minHeight: 36 }}
            />
          </View>
        </View>

        {doses.isPending ? (
          <Placeholder busy />
        ) : dashboard.pending.length === 0 && dashboard.completedCount === 0 ? (
          <Text size="sm" tone="mutedForeground">
            {isToday
              ? t("medications.noIntakesDueToday")
              : isFuture
                ? t("medications.noIntakesPlannedForDate")
                : t("medications.noIntakesForDate")}
          </Text>
        ) : null}

        {dashboard.pending.map((slot) => (
          <PendingSlot
            key={slot.time}
            slot={slot}
            actionable={actionable}
            overdueIds={dashboard.overdueIds}
            recentlyActed={recentlyActed}
            onAct={act}
            onOpen={openCourse}
          />
        ))}

        {dashboard.completedCount > 0 ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: radius.lg,
              overflow: "hidden",
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => setCompletedOpen((open) => !open)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: space.md,
                paddingVertical: space.md,
                backgroundColor: pressed ? palette.mutedHalf : "transparent",
              })}
            >
              <Text size="sm" weight="medium" tone="mutedForeground">
                {offset < 0
                  ? t("medications.completedOnDate", { date: dateLabel })
                  : t("medications.completedToday")}{" "}
                ({dashboard.completedCount})
              </Text>
              <Icon icon={showCompleted ? ChevronDown : ChevronRight} tone="foreground" />
            </Pressable>
            {showCompleted
              ? dashboard.completed.map((slot) => (
                  <CompletedSlot
                    key={slot.time}
                    slot={slot}
                    onMore={offerActions}
                    onOpen={openCourse}
                  />
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
