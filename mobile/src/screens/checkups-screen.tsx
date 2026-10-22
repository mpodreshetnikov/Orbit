import type { CheckupCategory, CheckupItem, CheckupItemStatus } from "@orbit-types/checkup";
import { CHECKUP_CATEGORIES } from "@orbit-types/checkup";
import {
  checkupLateness,
  groupCheckups,
  isoDay,
  searchCheckups,
} from "@orbit-types/checkup-summary";
import { Stack, useRouter, type Href } from "expo-router";
import {
  AlertCircle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Plus,
  type LucideIcon,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, SectionList, View } from "react-native";
import { Chip, Choice } from "@/components/form";
import { Badge, Button, Icon, Placeholder, Text } from "@/components/ui";
import { categoryLabel } from "@/features/checkups/query";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useCheckups, usePerson } from "@/lib/queries";
import type { Palette } from "@/theme";
import { radius, space, usePalette } from "@/theme";

type Tab = "all" | "overdue" | "upcoming" | "inactive";

const STATUS_TONE: Record<CheckupItemStatus, keyof Palette> = {
  active: "success",
  paused: "warningText",
  completed: "mutedForeground",
  archived: "mutedForeground",
};

/** "Активный", "Приостановлен": the web card's status badge. */
export function CheckupStatusBadge({ status }: { status: CheckupItemStatus }) {
  const key = `checkups.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  return <Badge label={t(key)} textTone={STATUS_TONE[status]} />;
}

/**
 * The person's checkups — the web checkups page: overdue first, then this week's, later ones and
 * the rest, or one of those alone from the chips, narrowed by category and by the search bar. Each
 * card opens the checkup, and an active one is marked done or planned for a day from the card.
 */
export default function CheckupsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const checkups = useCheckups(person.data?.id);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [category, setCategory] = useState<CheckupCategory | "all">("all");

  const items = checkups.data ?? [];
  const filtered = searchCheckups(
    category === "all" ? items : items.filter((item) => item.category === category),
    query,
  );
  const groups = groupCheckups(filtered, new Date());
  const sections: { key: string; title: string; icon?: LucideIcon; data: CheckupItem[] }[] = (
    tab === "all"
      ? [
          { key: "overdue", title: t("checkups.overdue"), icon: AlertCircle, data: groups.overdue },
          { key: "upcoming", title: t("checkups.upcoming"), icon: Clock, data: groups.upcoming },
          { key: "later", title: t("checkups.later"), data: groups.later },
          { key: "inactive", title: t("checkups.inactive"), data: groups.rest },
        ]
      : [
          {
            key: tab,
            title: t(`checkups.${tab}`),
            data:
              tab === "overdue"
                ? groups.overdue
                : tab === "upcoming"
                  ? groups.upcoming
                  : groups.rest,
          },
        ]
  ).filter((section) => section.data.length > 0);

  const tabs: [Tab, string][] = [
    ["all", t("checkups.all")],
    ["overdue", `${t("checkups.overdue")} ${groups.overdue.length || ""}`.trim()],
    ["upcoming", `${t("checkups.upcoming")} ${groups.upcoming.length || ""}`.trim()],
    ["inactive", `${t("checkups.inactive")} ${groups.rest.length || ""}`.trim()],
  ];

  const header = (
    <Stack.Screen
      options={{
        title: t("checkups.navTitle"),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("checkups.add")}
            hitSlop={space.sm}
            onPress={() => router.push("/health/checkups/form" as Href)}
          >
            <Icon icon={Plus} size={22} tone="foreground" />
          </Pressable>
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

  if (person.error || checkups.error) {
    return (
      <>
        {header}
        <Placeholder
          message={(person.error ?? checkups.error)?.message ?? t("common.error")}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : checkups.refetch())}
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
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm }}
            >
              {tabs.map(([one, label]) => (
                <Chip key={one} label={label} selected={tab === one} onPress={() => setTab(one)} />
              ))}
            </ScrollView>
            <Choice<CheckupCategory | "all">
              label={t("checkups.category")}
              value={category}
              options={[
                ["all", t("records.allTypes")],
                ...CHECKUP_CATEGORIES.map((one): [CheckupCategory, string] => [
                  one,
                  categoryLabel(one),
                ]),
              ]}
              onPick={setCategory}
            />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              marginTop: space.lg,
              marginBottom: space.sm,
            }}
          >
            {section.icon ? (
              <Icon
                icon={section.icon}
                tone={section.key === "overdue" ? "warningText" : "mutedForeground"}
              />
            ) : null}
            <Text
              size="sm"
              weight="medium"
              tone={section.key === "overdue" ? "warningText" : "mutedForeground"}
            >
              {section.title} ({section.data.length})
            </Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListEmptyComponent={
          checkups.isPending || person.isPending ? (
            <Placeholder busy />
          ) : (
            <View style={{ paddingVertical: space.xl, gap: space.xs, alignItems: "center" }}>
              <Text weight="medium">
                {items.length === 0 ? t("checkups.noItems") : t("common.noResults")}
              </Text>
              {items.length === 0 ? (
                <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
                  {t("checkups.noItemsHint")}
                </Text>
              ) : null}
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={checkups.isRefetching}
            onRefresh={() => void checkups.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item }) => (
          <CheckupCard
            item={item}
            onPress={() => router.push(`/health/checkups/${item.id}` as Href)}
            onComplete={() => router.push(`/health/checkups/complete?id=${item.id}` as Href)}
            onPlan={() => router.push(`/health/checkups/plan?id=${item.id}` as Href)}
          />
        )}
      />
    </>
  );
}

/** The web `CheckupCard`. */
function CheckupCard({
  item,
  onPress,
  onComplete,
  onPlan,
}: {
  item: CheckupItem;
  onPress: () => void;
  onComplete: () => void;
  onPlan: () => void;
}) {
  const palette = usePalette();
  const late = checkupLateness(item, isoDay(new Date()));
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: late.byDue || late.byPlan ? palette.warning : palette.border,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
      })}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
        <Text size="xs" tone="mutedForeground">
          {categoryLabel(item.category)}
        </Text>
        <CheckupStatusBadge status={item.status} />
        {late.byDue ? <Badge label={t("checkups.overdue")} textTone="warningText" /> : null}
        {late.byPlan ? <Badge label={t("checkups.plannedOverdue")} textTone="primary" /> : null}
      </View>
      <Text weight="medium" numberOfLines={1}>
        {item.title}
      </Text>
      {item.next_due_at ? (
        <DateLine icon={Calendar} label={t("checkups.nextDue")} day={item.next_due_at} />
      ) : null}
      {item.planned_on ? (
        <DateLine icon={CalendarPlus} label={t("checkups.plannedOn")} day={item.planned_on} />
      ) : null}
      {item.status === "active" ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: space.sm,
          }}
        >
          <Button
            compact
            variant="outline"
            icon={CheckCircle2}
            label={t("checkups.markComplete")}
            onPress={onComplete}
          />
          {item.next_due_at ? (
            <Button
              compact
              variant="outline"
              icon={CalendarPlus}
              label={t("checkups.plan")}
              onPress={onPlan}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function DateLine({ icon, label, day }: { icon: LucideIcon; label: string; day: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Icon icon={icon} size={14} />
      <Text size="xs" tone="mutedForeground">
        {label}: {formatDay(day)}
      </Text>
    </View>
  );
}
