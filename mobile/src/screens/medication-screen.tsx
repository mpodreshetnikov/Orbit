import { getCourseWindow } from "@orbit-types/regimen";
import { Stack, useLocalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import { ChevronRight, Clock, Ellipsis } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { showCourseSheet } from "@/components/course-sheet";
import { RefillSnooze } from "@/components/refill-snooze";
import { HistoryRow, dateTimeLabel } from "@/components/history-row";
import { LowStockBadge, StatusBadge } from "@/components/medication-badges";
import { showDoseSheet } from "@/components/dose-sheet";
import { Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import type { DayDose } from "@/features/doses/model";
import {
  formatAmountWithUnit,
  intakeAdviceLabel,
  isLowInventory,
  scheduleSummary,
} from "@/features/medications/format";
import { displayStatus } from "@/features/medications/list";
import { t } from "@/lib/i18n";
import {
  useChangeStock,
  useCourseChange,
  useDoseAction,
  useDoseHistory,
  useRegimen,
  type DoseAction,
} from "@/lib/queries";
import { space, usePalette } from "@/theme";

/** How many intakes the course screen lists before "all of them" takes over. */
const RECENT = 5;

/** A stored `YYYY-MM-DD` as the web app's `PP` prints it in Russian: "21 окт. 2026 г.". */
function calendarDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("ru", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One course — the web course page.
 *
 * The card says what the course is: its status, its schedule, its dates, its stock and notes, and,
 * when the stock runs low, lets the reminder about it be put off. Below it the last few intakes, each
 * answerable or undoable from its menu exactly as on the web, and a row into the full history. The
 * button in the bar holds what the web page's toolbar does: edit, refill, archive or bring back, delete. Reached from either tab, so the history it opens is pushed onto whichever
 * stack the course is on and the back gesture returns where it came from.
 */
export default function MedicationScreen() {
  const palette = usePalette();
  const router = useRouter();
  const pathname = usePathname();
  const { id } = useLocalSearchParams<{ id: string }>();
  const regimen = useRegimen(id);
  const history = useDoseHistory(id);
  const action = useDoseAction();
  const change = useCourseChange();
  const stock = useChangeStock();

  const act = useCallback(
    (dose: DayDose, kind: DoseAction) =>
      action.mutate({ dose, action: kind, at: new Date().toISOString() }),
    [action],
  );

  const course = regimen.data;
  const title = course?.custom_name ?? "";
  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: course
          ? () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("common.actions")}: ${course.custom_name}`}
                hitSlop={space.sm}
                onPress={() =>
                  showCourseSheet(course, {
                    edit: () => router.push(`${pathname}/edit` as Href),
                    change: (kind) =>
                      change.mutate(
                        { regimenId: course.id, change: kind },
                        { onSuccess: () => kind !== "unarchive" && router.back() },
                      ),
                    refill: (amount) => stock.mutate({ regimenId: course.id, amount }),
                  })
                }
              >
                <Icon icon={Ellipsis} size={22} tone="foreground" />
              </Pressable>
            )
          : undefined,
      }}
    />
  );

  if (regimen.error || history.error) {
    return (
      <>
        {header}
        <Placeholder
          message={(regimen.error ?? history.error)?.message ?? t("common.error")}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (regimen.error ? regimen.refetch() : history.refetch())}
            />
          }
        />
      </>
    );
  }
  if (regimen.isPending) {
    return (
      <>
        {header}
        <Placeholder busy />
      </>
    );
  }
  if (!course) {
    return (
      <>
        {header}
        <Placeholder message={t("common.noResults")} />
      </>
    );
  }

  const summary = scheduleSummary(course);
  const advice = intakeAdviceLabel(course);
  const { start, end } = getCourseWindow(course.duration);
  const inventory = course.inventory;
  const doses = history.data ?? [];

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={regimen.isRefetching || history.isRefetching}
            onRefresh={() => void Promise.all([regimen.refetch(), history.refetch()])}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <Card style={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <StatusBadge status={displayStatus(course)} />
            {isLowInventory(course) ? (
              <LowStockBadge label={t("medications.refillWarning")} />
            ) : null}
          </View>
          {summary ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon icon={Clock} />
              <Text size="sm" tone="mutedForeground" style={{ flex: 1 }}>
                {summary}
              </Text>
            </View>
          ) : null}
          {advice ? (
            <Text size="sm" tone="mutedForeground">
              {advice}
            </Text>
          ) : null}
          {start || end || course.duration?.type === "endless" ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                columnGap: space.lg,
                rowGap: space.xs,
              }}
            >
              {start ? (
                <Text size="sm" tone="mutedForeground">
                  {t("medications.startDate")}: {calendarDay(start)}
                </Text>
              ) : null}
              {end ? (
                <Text size="sm" tone="mutedForeground">
                  {t("medications.endDate")}: {calendarDay(end)}
                </Text>
              ) : course.duration?.type === "endless" ? (
                <Text size="sm" tone="mutedForeground">
                  {t("medications.endTypeEndless")}
                </Text>
              ) : null}
            </View>
          ) : null}
          {inventory?.enabled ? (
            <Text size="sm" tone="mutedForeground">
              {t("medications.inventoryCurrent")}:{" "}
              {inventory.current_amount != null
                ? formatAmountWithUnit(inventory.current_amount, course.intake_unit)
                : "—"}
              {inventory.refill_threshold_amount != null
                ? ` (${t("medications.refillWarning")} ≤ ${formatAmountWithUnit(inventory.refill_threshold_amount, course.intake_unit)})`
                : ""}
            </Text>
          ) : null}
          {isLowInventory(course) ? <RefillSnooze regimenId={course.id} /> : null}
          {course.notes ? (
            <View style={{ gap: 2 }}>
              <Text size="xs" weight="medium" tone="mutedForeground">
                {t("medications.notes")}
              </Text>
              <Text size="sm">{course.notes}</Text>
            </View>
          ) : null}
        </Card>

        <Card style={{ padding: space.lg, gap: space.sm }}>
          <Text weight="semibold">{t("medications.intakeHistory")}</Text>
          {history.isPending ? (
            <Placeholder busy />
          ) : doses.length === 0 ? (
            <Text size="sm" tone="mutedForeground">
              {t("medications.noIntakes")}
            </Text>
          ) : (
            doses
              .slice(0, RECENT)
              .map((dose) => (
                <HistoryRow
                  key={dose.id}
                  dose={dose}
                  when={dateTimeLabel(dose)}
                  onMore={(one) => showDoseSheet(one, act)}
                />
              ))
          )}
          {doses.length > 0 ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`${pathname}/history` as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: space.xs,
                paddingTop: space.md,
                borderTopWidth: 1,
                borderTopColor: palette.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text size="sm" weight="medium">
                {t("medications.intakeHistory")} · {doses.length}
              </Text>
              <Icon icon={ChevronRight} />
            </Pressable>
          ) : null}
        </Card>
      </ScrollView>
    </>
  );
}
