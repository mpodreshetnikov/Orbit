import { matchesCatalogEntry } from "@orbit-types/clinical-catalog";
import { Stack, useRouter, type Href } from "expo-router";
import { MapPin, MoreHorizontal, Plus, Stethoscope } from "lucide-react-native";
import { useState } from "react";
import { ActionSheetIOS, Alert, FlatList, Pressable, View } from "react-native";
import { Badge, Button, Icon, Placeholder, Text } from "@/components/ui";
import type { ClinicalCatalogKind, ClinicalEntry } from "@/features/catalogs/query";
import { t } from "@/lib/i18n";
import { useClinicalCatalog, useSaveClinicalEntry } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** How long the system sheet takes to slide away before an alert may be shown. */
const SHEET_DISMISS_MS = 400;

/** Each catalogue's words and icon, from the web pages. */
export const CLINICAL_CATALOG = {
  "finding-types": {
    title: "catalogs.findingTypes",
    add: "catalogs.addFindingType",
    edit: "catalogs.editFindingType",
    icon: Stethoscope,
  },
  "body-sites": {
    title: "catalogs.bodySites",
    add: "catalogs.addBodySite",
    edit: "catalogs.editBodySite",
    icon: MapPin,
  },
} as const;

/** How many synonyms a card shows before "+N", as on the web. */
const SHOWN_SYNONYMS = 3;

/**
 * "Типы находок" and "Локализации" — the web catalogue pages: every entry by code, with its names,
 * parent and first synonyms, searched from the bar. "+" adds one; an entry's menu edits or deletes
 * it, the delete asked first with the web page's question.
 */
export default function ClinicalCatalogScreen({ kind }: { kind: ClinicalCatalogKind }) {
  const router = useRouter();
  const palette = usePalette();
  const words = CLINICAL_CATALOG[kind];
  const catalog = useClinicalCatalog(kind);
  const save = useSaveClinicalEntry(kind);
  const [query, setQuery] = useState("");

  const open = (id?: string) =>
    router.push(`/health/catalogs/${kind}/form${id ? `?id=${id}` : ""}` as Href);

  const confirmRemove = (entry: ClinicalEntry) =>
    Alert.alert(
      t("catalogs.deleteTitle"),
      t("catalogs.deleteDescription", { name: entry.name_ru }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () =>
            save.mutate(
              { id: entry.id, columns: null },
              { onError: (error) => Alert.alert(t("common.error"), error.message) },
            ),
        },
      ],
    );

  const more = (entry: ClinicalEntry) =>
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
        title: t(words.title),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(words.add)}
            hitSlop={space.sm}
            onPress={() => open()}
          >
            <Icon icon={Plus} size={24} tone="foreground" />
          </Pressable>
        ),
        headerSearchBarOptions: {
          placeholder: t("catalogs.searchPlaceholder"),
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
      <FlatList
        data={(catalog.data ?? []).filter((entry) => matchesCatalogEntry(entry.code, entry, query))}
        keyExtractor={(entry) => entry.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListEmptyComponent={
          catalog.isPending ? (
            <Placeholder busy />
          ) : (
            <Text tone="mutedForeground" style={{ textAlign: "center", padding: space.xl }}>
              {t(query.trim() ? "catalogs.noSearchResults" : "catalogs.noItems")}
            </Text>
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
            <Icon icon={words.icon} size={16} tone="primary" />
            <View style={{ flex: 1, gap: space.xs }}>
              <Text weight="medium">{item.name_ru}</Text>
              <Text size="xs" tone="mutedForeground">
                {[item.code, item.name_en, item.parent_code && `↳ ${item.parent_code}`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {item.synonyms_ru.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                  {item.synonyms_ru.slice(0, SHOWN_SYNONYMS).map((synonym) => (
                    <Badge key={synonym} label={synonym} />
                  ))}
                  {item.synonyms_ru.length > SHOWN_SYNONYMS ? (
                    <Badge label={`+${item.synonyms_ru.length - SHOWN_SYNONYMS}`} />
                  ) : null}
                </View>
              ) : null}
            </View>
            <Icon icon={MoreHorizontal} />
          </Pressable>
        )}
      />
    </>
  );
}
