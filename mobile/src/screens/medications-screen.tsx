import type { MedRegimen } from "@orbit-types/regimen";
import { Stack, useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Plus, Settings } from "lucide-react-native";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { unitIcon } from "@/components/medication-icons";
import { filterLabel, LowStockBadge, StatusBadge } from "@/components/medication-badges";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import {
  formatAmountWithUnit,
  isLowInventory,
  scheduleSummary,
} from "@/features/medications/format";
import {
  displayStatus,
  filterRegimens,
  STATUS_FILTERS,
  type StatusFilter,
} from "@/features/medications/list";
import { t } from "@/lib/i18n";
import { usePerson, useOverdueInterval, useRegimens, useSaveOverdueInterval } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/**
 * Every course the person has — the web medications page's list, with its search and status filter.
 *
 * The search is the system's own, in the navigation bar under the large title; the filter is a row
 * of chips rather than the web's select, because a phone shows five short words at once. Each card is
 * the web `RegimenCard` and opens the course. The gear in the bar is the web page's settings dialog:
 * how often an overdue dose is reminded about again, in the system's prompt; the plus adds a course.
 */
export default function MedicationsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const regimens = useRegimens(person.data?.id);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const interval = useOverdueInterval();
  const saveInterval = useSaveOverdueInterval();

  const editInterval = () =>
    Alert.prompt(
      t("medications.overdueReminderInterval"),
      `${t("medications.overdueReminderIntervalDescription")}\n(${t("medications.overdueReminderIntervalMinutes")})`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.save"),
          onPress: (typed?: string) => {
            const minutes = Number((typed ?? "").trim());
            if (Number.isFinite(minutes) && minutes > 0) saveInterval.mutate(minutes);
          },
        },
      ],
      "plain-text",
      String(interval.data ?? ""),
      "number-pad",
    );

  /** The web page's two add buttons as one: a one-off intake or a regular course. */
  const add = () => {
    const kinds = ["one_time", "regular"] as const;
    const options = [t("medications.oneTime"), t("medications.regular"), t("common.cancel")];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: t("medications.add"), options, cancelButtonIndex: options.length - 1 },
      (index) => {
        const kind = kinds[index];
        if (kind) router.push(`/medications/new?kind=${kind}` as Href);
      },
    );
  };

  const visible = useMemo(
    () => filterRegimens(regimens.data ?? [], { status, query }),
    [regimens.data, status, query],
  );

  const header = (
    <Stack.Screen
      options={{
        title: t("medications.navTitle"),
        headerRight: () => (
          <View style={{ flexDirection: "row", gap: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("medications.settings")}
              hitSlop={space.sm}
              onPress={editInterval}
            >
              <Icon icon={Settings} size={22} tone="foreground" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("medications.add")}
              hitSlop={space.sm}
              onPress={add}
            >
              <Icon icon={Plus} size={24} tone="foreground" />
            </Pressable>
          </View>
        ),
        headerSearchBarOptions: {
          placeholder: t("common.search"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  if (person.error || regimens.error) {
    return (
      <>
        {header}
        <Placeholder
          message={(person.error ?? regimens.error)?.message ?? t("common.error")}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : regimens.refetch())}
            />
          }
        />
      </>
    );
  }

  const filters = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingBottom: space.xs }}
    >
      {STATUS_FILTERS.map((filter) => {
        const selected = filter === status;
        return (
          <Pressable
            key={filter}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => setStatus(filter)}
            style={({ pressed }) => ({
              paddingHorizontal: space.md,
              minHeight: 32,
              justifyContent: "center",
              borderRadius: 999,
              borderWidth: 1,
              borderColor: selected ? palette.primary : palette.border,
              backgroundColor: selected
                ? palette.primary
                : pressed
                  ? palette.muted
                  : palette.background,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <Text size="sm" weight="medium" tone={selected ? "primaryForeground" : "foreground"}>
              {filterLabel(filter)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <>
      {header}
      <FlatList
        data={visible}
        keyExtractor={(regimen) => regimen.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 }}
        ListHeaderComponent={filters}
        ListEmptyComponent={
          regimens.isPending ? (
            <Placeholder busy />
          ) : (regimens.data?.length ?? 0) === 0 ? (
            <View style={{ paddingVertical: space.xl, gap: space.xs, alignItems: "center" }}>
              <Text weight="medium">{t("medications.noItems")}</Text>
              <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
                {t("medications.noItemsHint")}
              </Text>
            </View>
          ) : (
            <Placeholder message={t("common.noResults")} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={regimens.isRefetching}
            onRefresh={() => void regimens.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item }) => (
          <RegimenCard
            regimen={item}
            onPress={() => router.push(`/medications/${item.id}` as Href)}
          />
        )}
      />
    </>
  );
}

function RegimenCard({ regimen, onPress }: { regimen: MedRegimen; onPress: () => void }) {
  const palette = usePalette();
  const low = isLowInventory(regimen);
  const summary = scheduleSummary(regimen);
  const inventory = regimen.inventory;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: low ? palette.warning : palette.border,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text weight="medium" numberOfLines={1}>
            {regimen.custom_name}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <StatusBadge status={displayStatus(regimen)} />
            {low ? <LowStockBadge label={t("medications.lowInventory")} /> : null}
          </View>
        </View>
        <Icon icon={unitIcon(regimen.intake_unit)} />
      </View>
      {summary ? (
        <Text size="xs" tone="mutedForeground" numberOfLines={2}>
          {summary}
        </Text>
      ) : null}
      {inventory?.enabled && inventory.current_amount != null ? (
        <Text size="xs" tone="mutedForeground">
          {formatAmountWithUnit(inventory.current_amount, regimen.intake_unit)}{" "}
          {t("medications.stockLeft")}
        </Text>
      ) : null}
    </Pressable>
  );
}
