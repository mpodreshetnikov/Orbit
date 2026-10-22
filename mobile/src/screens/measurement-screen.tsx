import type { MeasurementHistoryPoint } from "@orbit-types/measurement";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { MoreHorizontal, Plus, TrendingDown, TrendingUp } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { LineChart } from "@/components/charts";
import { Badge, Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import {
  categoryLabel,
  formatDay,
  formatMoment,
  formatValue,
  trendPercent,
} from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import {
  useHiddenMeasurements,
  useMeasurements,
  usePerson,
  useSaveMeasurement,
} from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** How long the system sheet takes to slide away before an alert may be shown. */
const SHEET_DISMISS_MS = 400;

/**
 * One measurement's history — the web measurement page: the four summary cards, the chart and the
 * history, each entry editable or deletable from its menu. "+" in the bar records a new value of this
 * type.
 */
export default function MeasurementScreen() {
  const router = useRouter();
  const palette = usePalette();
  const { code } = useLocalSearchParams<{ code: string }>();
  const person = usePerson();
  const measurements = useMeasurements(person.data?.id);
  const hidden = useHiddenMeasurements(person.data?.id);
  const save = useSaveMeasurement();
  const measurement = measurements.data?.find((one) => one.code === code);

  const add = () =>
    router.push(`/health/measurements/form?code=${encodeURIComponent(code)}` as Href);

  const header = (
    <Stack.Screen
      options={{
        title: measurement?.name_ru ?? code,
        headerLargeTitle: false,
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("measurements.addMeasurement")}
            hitSlop={space.sm}
            onPress={add}
          >
            <Icon icon={Plus} size={24} tone="foreground" />
          </Pressable>
        ),
      }}
    />
  );

  if (!measurement) {
    return (
      <>
        {header}
        {(measurements.isPending || person.isPending) && !person.error ? (
          <Placeholder busy />
        ) : (
          <Placeholder
            message={(person.error ?? measurements.error)?.message ?? t("measurements.noData")}
          />
        )}
      </>
    );
  }

  const unit = measurement.unit_ru;
  const trend = trendPercent(measurement.history);
  const newestFirst = [...measurement.history].reverse();

  const remove = (point: MeasurementHistoryPoint) =>
    Alert.alert(t("measurements.deleteTitle"), t("measurements.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => save.mutate({ id: point.id, remove: true }),
      },
    ]);

  const more = (point: MeasurementHistoryPoint) => {
    const labels = [t("common.edit"), t("common.delete"), t("common.cancel")];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${formatValue(point.value, 2)} ${unit} · ${formatMoment(point.measured_at)}`,
        options: labels,
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) {
          router.push(
            `/health/measurements/form?code=${encodeURIComponent(code)}&entry=${point.id}` as Href,
          );
        } else if (index === 1) {
          setTimeout(() => remove(point), SHEET_DISMISS_MS);
        }
      },
    );
  };

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={measurements.isRefetching}
            onRefresh={() => void measurements.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <Badge label={code} />
          {hidden.codes.has(code) ? (
            <Badge label={t("measurements.hiddenBadge")} surface={palette.secondary} />
          ) : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Stat title={t("measurements.latestValue")}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.xs }}>
              <Text size="2xl" weight="bold">
                {formatValue(measurement.latest_value)}
              </Text>
              {unit ? <Text tone="mutedForeground">{unit}</Text> : null}
            </View>
            <Text size="xs" tone="mutedForeground">
              {formatDay(measurement.latest_date)}
            </Text>
          </Stat>
          <Stat title={t("measurements.trend")}>
            {trend === null ? (
              <Text tone="mutedForeground">—</Text>
            ) : trend.trend === "flat" ? (
              <Text tone="mutedForeground">{t("measurements.stable")}</Text>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Icon
                  icon={trend.trend === "up" ? TrendingUp : TrendingDown}
                  size={18}
                  tone={trend.trend === "up" ? "rising" : "falling"}
                />
                <Text
                  size="lg"
                  weight="semibold"
                  tone={trend.trend === "up" ? "rising" : "falling"}
                >
                  {trend.trend === "up" ? "+" : "-"}
                  {trend.percent.toFixed(1)}%
                </Text>
              </View>
            )}
          </Stat>
          <Stat title={t("measurements.totalMeasurements")}>
            <Text size="2xl" weight="bold">
              {measurement.measurement_count}
            </Text>
          </Stat>
          <Stat title={t("measurements.category")}>
            <Badge label={categoryLabel(measurement.category)} />
          </Stat>
        </View>

        <Card style={{ padding: space.lg, gap: space.md }}>
          <Text weight="semibold">{t("measurements.chartTitle")}</Text>
          <LineChart
            values={measurement.history.map((point) => point.value)}
            labels={[
              formatDay(measurement.history[0].measured_at),
              formatDay(measurement.latest_date),
            ]}
            format={(value) => formatValue(value)}
          />
        </Card>

        <Card style={{ padding: space.sm, gap: space.xs }}>
          <Text weight="semibold" style={{ padding: space.sm }}>
            {t("measurements.historyTitle")}
          </Text>
          {newestFirst.map((point) => (
            <Pressable
              key={point.id}
              accessibilityRole="button"
              accessibilityLabel={`${formatMoment(point.measured_at)} ${formatValue(point.value, 2)}`}
              onPress={() => more(point)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                padding: space.sm,
                borderRadius: radius.sm,
                backgroundColor: pressed ? palette.mutedHalf : "transparent",
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text size="sm">{formatMoment(point.measured_at)}</Text>
                {point.notes ? (
                  <Text size="xs" tone="mutedForeground" numberOfLines={2}>
                    {point.notes}
                  </Text>
                ) : null}
              </View>
              <Text weight="semibold">
                {formatValue(point.value, 2)}
                {unit ? <Text tone="mutedForeground"> {unit}</Text> : null}
              </Text>
              <Icon icon={MoreHorizontal} />
            </Pressable>
          ))}
        </Card>
        <Button variant="outline" label={t("measurements.addMeasurement")} onPress={add} />
      </ScrollView>
    </>
  );
}

/** One of the web page's four summary cards, two to a row. */
function Stat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ flexBasis: "48%", flexGrow: 1, padding: space.md, gap: space.xs }}>
      <Text size="xs" weight="medium" tone="mutedForeground">
        {title}
      </Text>
      {children}
    </Card>
  );
}
