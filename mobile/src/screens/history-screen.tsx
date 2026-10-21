import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { RefreshControl, SectionList, View } from "react-native";
import { HistoryRow, doseMoment } from "@/components/history-row";
import { showDoseSheet } from "@/components/dose-sheet";
import { Button, Placeholder, Text } from "@/components/ui";
import { clockTime, type DayDose } from "@/features/doses/model";
import { t } from "@/lib/i18n";
import { dayKey, useDoseAction, useDoseHistory, useRegimen, type DoseAction } from "@/lib/queries";
import { space, usePalette } from "@/theme";

type Day = { key: string; title: string; data: DayDose[] };

/** The history grouped by local day, latest day first; the rows arrive already latest first. */
function byDay(doses: readonly DayDose[]): Day[] {
  const days: Day[] = [];
  for (const dose of doses) {
    const at = doseMoment(dose);
    const key = dayKey(at);
    const last = days[days.length - 1];
    if (last?.key === key) {
      last.data.push(dose);
    } else {
      days.push({
        key,
        title: at.toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" }),
        data: [dose],
      });
    }
  }
  return days;
}

/**
 * Every intake of one course, by day, each answerable or undoable from its menu. The pushed screen
 * behind the course's "История приёмов" row; the headings stay pinned while their day scrolls.
 */
export default function HistoryScreen() {
  const palette = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const regimen = useRegimen(id);
  const history = useDoseHistory(id);
  const action = useDoseAction();
  const sections = useMemo(() => byDay(history.data ?? []), [history.data]);

  const act = useCallback(
    (dose: DayDose, kind: DoseAction) =>
      action.mutate({ dose, action: kind, at: new Date().toISOString() }),
    [action],
  );

  const header = (
    <Stack.Screen
      options={{
        title: t("medications.intakeHistory"),
        headerLargeTitle: false,
        headerBackTitle: regimen.data?.custom_name,
      }}
    />
  );

  if (history.error) {
    return (
      <>
        {header}
        <Placeholder
          message={history.error.message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void history.refetch()}
            />
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(dose) => dose.id}
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl * 2 }}
        ListHeaderComponent={
          regimen.data ? (
            <Text size="sm" tone="mutedForeground" style={{ paddingTop: space.md }}>
              {regimen.data.custom_name}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          history.isPending ? (
            <Placeholder busy />
          ) : (
            <Placeholder message={t("medications.noIntakes")} />
          )
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              backgroundColor: palette.background,
              paddingTop: space.lg,
              paddingBottom: space.xs,
            }}
          >
            <Text size="sm" weight="medium" tone="mutedForeground">
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <HistoryRow
            dose={item}
            when={clockTime(doseMoment(item).toISOString())}
            onMore={(one) => showDoseSheet(one, act)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={history.isRefetching}
            onRefresh={() => void history.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      />
    </>
  );
}
