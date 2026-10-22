import type { MeasurementSummary } from "@orbit-types/measurement";
import { searchMeasurementSummaries } from "@orbit-types/measurement-summary";
import { getMeasurementTrend } from "@orbit-types/measurement-trend";
import { Stack, useRouter, type Href } from "expo-router";
import { Minus, Plus, SlidersHorizontal, TrendingDown, TrendingUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, SectionList, View } from "react-native";
import { Sparkline } from "@/components/charts";
import { Badge, Button, Icon, Placeholder, Text } from "@/components/ui";
import { byCategory, categoryLabel, formatDay, formatValue } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useHiddenMeasurements, useMeasurements, usePerson } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** The latest change as the web card marks it: up in orange, down in blue, flat in grey. */
export function TrendMark({ history }: { history: { value: number }[] }) {
  const trend = getMeasurementTrend(history);
  if (trend === "up") return <Icon icon={TrendingUp} tone="rising" />;
  if (trend === "down") return <Icon icon={TrendingDown} tone="falling" />;
  if (trend === "flat") return <Icon icon={Minus} />;
  return null;
}

/**
 * The person's measurements — the web measurements page's cards, grouped by category as it groups
 * them, with its search in the navigation bar and its "choose measurements" behind the sliders in
 * the bar. The web page's table and body-map views are left to the web: on a phone the cards already
 * show every value, and the table is the same history a card opens.
 */
export default function MeasurementsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const measurements = useMeasurements(person.data?.id);
  const hidden = useHiddenMeasurements(person.data?.id);
  const [query, setQuery] = useState("");

  const all = measurements.data ?? [];
  const shown = searchMeasurementSummaries(all, query).filter((one) => !hidden.codes.has(one.code));
  const hiddenCount = all.filter((one) => hidden.codes.has(one.code)).length;

  const header = (
    <Stack.Screen
      options={{
        title: t("measurements.title"),
        headerRight: () => (
          <View style={{ flexDirection: "row", gap: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("measurements.manageVisibility")}
              hitSlop={space.sm}
              onPress={() => router.push("/health/measurements/visibility" as Href)}
            >
              <Icon icon={SlidersHorizontal} size={22} tone="foreground" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("measurements.addMeasurement")}
              hitSlop={space.sm}
              onPress={() => router.push("/health/measurements/form" as Href)}
            >
              <Icon icon={Plus} size={24} tone="foreground" />
            </Pressable>
          </View>
        ),
        headerSearchBarOptions: {
          placeholder: t("measurements.searchPlaceholder"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  if (person.error || measurements.error) {
    return (
      <>
        {header}
        <Placeholder
          message={(person.error ?? measurements.error)?.message ?? t("common.error")}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : measurements.refetch())}
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
        sections={byCategory(shown)}
        keyExtractor={(item) => item.code}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
        renderSectionHeader={({ section }) => (
          <Text
            size="xs"
            weight="medium"
            tone="mutedForeground"
            style={{ marginTop: space.md, marginBottom: space.sm, marginLeft: space.xs }}
          >
            {categoryLabel(section.category).toUpperCase()}
          </Text>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListEmptyComponent={
          measurements.isPending || person.isPending ? (
            <Placeholder busy />
          ) : all.length === 0 ? (
            <View style={{ paddingVertical: space.xl, gap: space.xs, alignItems: "center" }}>
              <Text weight="medium">{t("measurements.noData")}</Text>
              <Text size="sm" tone="mutedForeground">
                {t("measurements.addFirst")}
              </Text>
            </View>
          ) : (
            <Placeholder
              message={t(query ? "measurements.noSearchResults" : "measurements.allHidden")}
            />
          )
        }
        ListFooterComponent={
          hiddenCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/health/measurements/visibility" as Href)}
              style={{ paddingTop: space.lg, alignItems: "center" }}
            >
              <Text size="sm" tone="mutedForeground">
                {t("measurements.hiddenSummary", { count: hiddenCount })}
              </Text>
            </Pressable>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={measurements.isRefetching}
            onRefresh={() => void measurements.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item }) => (
          <MeasurementCard
            measurement={item}
            onPress={() =>
              router.push(`/health/measurements/${encodeURIComponent(item.code)}` as Href)
            }
          />
        )}
      />
    </>
  );
}

/** The web `MeasurementCard`: name, category, sparkline, the latest value with its trend. */
function MeasurementCard({
  measurement,
  onPress,
}: {
  measurement: MeasurementSummary;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text weight="medium" numberOfLines={1}>
            {measurement.name_ru}
          </Text>
          <Badge label={categoryLabel(measurement.category)} />
        </View>
        <Sparkline values={measurement.history.map((point) => point.value)} />
      </View>
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}
      >
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text size="2xl" weight="bold">
              {formatValue(measurement.latest_value)}
            </Text>
            {measurement.unit_ru ? (
              <Text size="sm" tone="mutedForeground">
                {measurement.unit_ru}
              </Text>
            ) : null}
            <TrendMark history={measurement.history} />
          </View>
          <Text size="xs" tone="mutedForeground">
            {formatDay(measurement.latest_date)}
          </Text>
        </View>
        <Text size="xs" tone="mutedForeground">
          {measurement.measurement_count} {t("measurements.measurements")}
        </Text>
      </View>
    </Pressable>
  );
}
