import type { MeasurementCatalog } from "@orbit-types/measurement";
import { searchMeasurementSummaries } from "@orbit-types/measurement-summary";
import { Stack, useRouter, type Href } from "expo-router";
import { MoreHorizontal, Plus } from "lucide-react-native";
import { useState } from "react";
import { ActionSheetIOS, Alert, Pressable, SectionList, View } from "react-native";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { byCategory, categoryLabel } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useMeasurementCatalog, useSaveCatalogEntry } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** How long the system sheet takes to slide away before an alert may be shown. */
const SHEET_DISMISS_MS = 400;

/**
 * "Каталог измерений" — the web catalogue page: every measurement type by category, with its code
 * and units, searched from the bar. "+" adds a type; a type's menu edits or deletes it, the delete
 * asked first with the web page's question. A type that still has measurements cannot be deleted,
 * and the database's refusal is shown as it comes.
 */
export default function MeasurementCatalogScreen() {
  const router = useRouter();
  const palette = usePalette();
  const catalog = useMeasurementCatalog();
  const save = useSaveCatalogEntry();
  const [query, setQuery] = useState("");

  const open = (id?: string) =>
    router.push(`/health/catalogs/measurements/form${id ? `?id=${id}` : ""}` as Href);

  const confirmRemove = (entry: MeasurementCatalog) =>
    Alert.alert(
      t("catalogs.deleteMeasurement"),
      t("catalogs.deleteMeasurementMessage", { code: entry.code }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () =>
            save.mutate(
              { id: entry.id, remove: true },
              { onError: (error) => Alert.alert(t("common.error"), error.message) },
            ),
        },
      ],
    );

  const more = (entry: MeasurementCatalog) =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: entry.name_ru,
        options: [t("common.edit"), t("common.delete"), t("common.cancel")],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) open(entry.id);
        if (index === 1) setTimeout(() => confirmRemove(entry), SHEET_DISMISS_MS);
      },
    );

  const header = (
    <Stack.Screen
      options={{
        title: t("catalogs.measurements"),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("catalogs.addMeasurement")}
            hitSlop={space.sm}
            onPress={() => open()}
          >
            <Icon icon={Plus} size={24} tone="foreground" />
          </Pressable>
        ),
        headerSearchBarOptions: {
          placeholder: t("catalogs.searchMeasurements"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  if (catalog.error) {
    return (
      <>
        {header}
        <Placeholder
          message={catalog.error.message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void catalog.refetch()}
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
        sections={byCategory(searchMeasurementSummaries(catalog.data ?? [], query))}
        keyExtractor={(entry) => entry.id}
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
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListEmptyComponent={
          catalog.isPending ? (
            <Placeholder busy />
          ) : (
            <View style={{ paddingVertical: space.xl, gap: space.xs, alignItems: "center" }}>
              <Text weight="medium">{t("catalogs.noMeasurements")}</Text>
              <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
                {t("catalogs.noMeasurementsDescription")}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name_ru} ${item.code}`}
            onPress={() => more(item)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              padding: space.md,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: pressed ? palette.mutedHalf : palette.card,
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="medium">
                {item.name_ru}
                {item.unit_ru ? <Text tone="mutedForeground"> · {item.unit_ru}</Text> : null}
              </Text>
              <Text size="xs" tone="mutedForeground">
                {item.code} · {item.name_en}
              </Text>
            </View>
            <Icon icon={MoreHorizontal} />
          </Pressable>
        )}
      />
    </>
  );
}
