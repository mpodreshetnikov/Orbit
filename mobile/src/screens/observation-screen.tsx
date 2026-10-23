import { isAbnormal } from "@orbit-types/observation-summary";
import { Stack, useLocalSearchParams } from "expo-router";
import { TrendingDown, TrendingUp } from "lucide-react-native";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { LineChart } from "@/components/charts";
import { ObservationStatusBadge } from "@/components/observation-status";
import { Card, Icon, Placeholder, Text } from "@/components/ui";
import { formatDay, formatValue, trendPercent } from "@/features/measurements/format";
import {
  chartPoints,
  pointValue,
  rangeText,
  shownValue,
  summaryRange,
} from "@/features/observations/format";
import { t } from "@/lib/i18n";
import { useObservations, usePerson } from "@/lib/queries";
import { space, usePalette } from "@/theme";

/**
 * One lab value's history — the web observation page: the latest value, its status against the
 * reference range, the range, the trend, the chart with the range shaded, and every result. The web
 * page's choice of display unit is left to the web; values show in the unit they were stored in.
 */
export default function ObservationScreen() {
  const palette = usePalette();
  const { code } = useLocalSearchParams<{ code: string }>();
  const person = usePerson();
  const observations = useObservations(person.data?.id);
  const observation = observations.data?.find((one) => one.obs_code === code);
  const title = observation?.catalog_name_ru || observation?.obs_name || code;

  const header = <Stack.Screen options={{ title, headerLargeTitle: false }} />;
  if (!observation) {
    return (
      <>
        {header}
        {observations.isPending || person.isPending ? (
          <Placeholder busy />
        ) : (
          <Placeholder
            message={
              (person.error ?? observations.error)?.message ?? t("observationHistory.noData")
            }
          />
        )}
      </>
    );
  }

  const unit = observation.latest_unit || observation.canonical_unit || "";
  const [low, high] = summaryRange(observation);
  const charted = chartPoints(observation.history);
  const values = charted.map((point) => point.value);
  const trend = trendPercent(charted);
  const newestFirst = [...observation.history].reverse();

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={observations.isRefetching}
            onRefresh={() => void observations.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Stat title={t("observationHistory.latestValue")}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.xs }}>
              <Text size="2xl" weight="bold">
                {shownValue(observation.latest_value, observation.latest_value_text)}
              </Text>
              <Text tone="mutedForeground">{unit}</Text>
            </View>
            {observation.latest_date ? (
              <Text size="xs" tone="mutedForeground">
                {formatDay(observation.latest_date)}
              </Text>
            ) : null}
          </Stat>
          <Stat title={t("observationHistory.status")}>
            <ObservationStatusBadge status={observation.latest_status} />
            {isAbnormal(observation.latest_status) ? (
              <Text size="xs" tone="rising">
                {t("observationHistory.outOfRange")}
              </Text>
            ) : null}
          </Stat>
          <Stat title={t("observationHistory.referenceRange")}>
            <Text size="lg" weight="semibold">
              {rangeText(low, high)}
            </Text>
          </Stat>
          <Stat title={t("observationHistory.trend")}>
            {trend === null ? (
              <Text tone="mutedForeground">—</Text>
            ) : trend.trend === "flat" ? (
              <Text tone="mutedForeground">{t("observationHistory.stable")}</Text>
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
            <Text size="xs" tone="mutedForeground">
              {observation.measurement_count} {t("observationHistory.measurements")}
            </Text>
          </Stat>
        </View>

        {values.length > 0 ? (
          <Card style={{ padding: space.lg, gap: space.md }}>
            <Text weight="semibold">{t("observationHistory.chartTitle")}</Text>
            <LineChart
              values={values}
              labels={[formatDay(charted[0].date), formatDay(charted[charted.length - 1].date)]}
              format={(value) => formatValue(value)}
              band={low !== null && high !== null ? [low, high] : undefined}
            />
          </Card>
        ) : null}

        <Card style={{ padding: space.sm, gap: space.xs }}>
          <Text weight="semibold" style={{ padding: space.sm }}>
            {t("observationHistory.historyTitle")}
          </Text>
          {newestFirst.map((point) => (
            <View
              key={point.id}
              accessibilityLabel={`${formatDay(point.record_date || point.created_at)} ${shownValue(pointValue(point), point.value_text, 2)}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                padding: space.sm,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text size="sm">{formatDay(point.record_date || point.created_at)}</Text>
                <Text size="xs" tone="mutedForeground">
                  {t("observationHistory.reference")}:{" "}
                  {rangeText(
                    point.ref_range_low_canonical ?? point.ref_range_low,
                    point.ref_range_high_canonical ?? point.ref_range_high,
                  )}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text weight="semibold">
                  {shownValue(pointValue(point), point.value_text, 2)}{" "}
                  <Text tone="mutedForeground">{point.unit_canonical || point.unit || ""}</Text>
                </Text>
                <ObservationStatusBadge status={point.status} />
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
    </>
  );
}

/** One of the web page's summary cards, two to a row. */
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
