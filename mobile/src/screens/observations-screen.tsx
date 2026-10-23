import type { ObservationSummary } from "@orbit-types/medical-record";
import { isAbnormal, searchObservationSummaries } from "@orbit-types/observation-summary";
import { Stack, useRouter, type Href } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { Sparkline } from "@/components/charts";
import { ObservationStatusBadge } from "@/components/observation-status";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { formatDay } from "@/features/measurements/format";
import { chartValues, shownValue, summaryRange } from "@/features/observations/format";
import { t } from "@/lib/i18n";
import { useObservations, usePerson } from "@/lib/queries";
import { TrendMark } from "@/screens/measurements-screen";
import { radius, space, usePalette, type Palette } from "@/theme";

/** The web sparkline's colour: blue under the range, orange over it, green inside, grey without. */
function sparkTone(summary: ObservationSummary): keyof Palette {
  const [low, high] = summaryRange(summary);
  const latest = summary.latest_value;
  if (latest === null) return "mutedForeground";
  if (low !== null && latest < low) return "falling";
  if (high !== null && latest > high) return "rising";
  return low !== null && high !== null ? "success" : "mutedForeground";
}

/**
 * The person's lab values — the web history page's cards, out-of-range ones first, with its search
 * in the bar. Its table view is left to the web; a card opens the same history.
 */
export default function ObservationsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const observations = useObservations(person.data?.id);
  const [query, setQuery] = useState("");
  const all = observations.data ?? [];

  const header = (
    <Stack.Screen
      options={{
        title: t("observationHistory.navTitle"),
        headerSearchBarOptions: {
          placeholder: t("observationHistory.searchPlaceholder"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  if (person.error || observations.error) {
    return (
      <>
        {header}
        <Placeholder
          message={(person.error ?? observations.error)?.message ?? t("common.error")}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : observations.refetch())}
            />
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <FlatList
        data={searchObservationSummaries(all, query)}
        keyExtractor={(item) => item.obs_code}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 }}
        ListEmptyComponent={
          observations.isPending || person.isPending ? (
            <Placeholder busy />
          ) : (
            <Placeholder
              message={t(
                all.length ? "observationHistory.noSearchResults" : "observationHistory.noData",
              )}
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={observations.isRefetching}
            onRefresh={() => void observations.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item }) => (
          <ObservationCard
            observation={item}
            onPress={() =>
              router.push(`/health/observations/${encodeURIComponent(item.obs_code)}` as Href)
            }
          />
        )}
      />
    </>
  );
}

/** The web `ObservationCard`. */
function ObservationCard({
  observation,
  onPress,
}: {
  observation: ObservationSummary;
  onPress: () => void;
}) {
  const palette = usePalette();
  const bad = isAbnormal(observation.latest_status);
  const values = chartValues(observation.history);
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: bad ? palette.warning : palette.border,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
              {observation.catalog_name_ru || observation.obs_name}
            </Text>
            {bad ? <Icon icon={AlertTriangle} size={14} tone="rising" /> : null}
          </View>
          {observation.obs_code !== observation.obs_name ? (
            <Text size="xs" tone="mutedForeground">
              {observation.obs_code}
            </Text>
          ) : null}
        </View>
        <Sparkline values={values} tone={sparkTone(observation)} />
      </View>
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}
      >
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text size="2xl" weight="bold">
              {shownValue(observation.latest_value, observation.latest_value_text)}
            </Text>
            <Text size="sm" tone="mutedForeground">
              {observation.latest_unit || observation.canonical_unit || ""}
            </Text>
            <TrendMark history={values.map((value) => ({ value }))} />
          </View>
          {observation.latest_date ? (
            <Text size="xs" tone="mutedForeground">
              {formatDay(observation.latest_date)}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: space.xs }}>
          <ObservationStatusBadge status={observation.latest_status} />
          <Text size="xs" tone="mutedForeground">
            {observation.measurement_count} {t("observationHistory.measurements")}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
