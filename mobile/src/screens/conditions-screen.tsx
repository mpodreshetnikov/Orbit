import type { ConditionStatus, ConditionWithHistory } from "@orbit-types/condition";
import { conditionSections, searchConditions } from "@orbit-types/condition-summary";
import { Stack, useRouter, type Href } from "expo-router";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Info,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, SectionList, View } from "react-native";
import {
  CONDITION_TONE,
  ConditionStatusBadge,
  ConditionStatusIcon,
} from "@/components/condition-status";
import { Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useConditions, usePerson } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

const SECTION_TITLE: Record<ConditionStatus, string> = {
  active: "conditions.activeSection",
  suspected: "conditions.suspectedSection",
  resolved: "conditions.resolvedSection",
  history: "conditions.historySection",
};

/** Resolved and past conditions are listed dimmed, as on the web page. */
const DIMMED = new Set<ConditionStatus>(["resolved", "history"]);

/**
 * The person's conditions — the web conditions page: the status guide, then a section per status,
 * each condition a card, searched from the bar. The web page's table view is left to the web.
 */
export default function ConditionsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const conditions = useConditions(person.data?.id);
  const [query, setQuery] = useState("");

  const sections = conditionSections(searchConditions(conditions.data ?? [], query));
  const shown = sections
    .filter((section) => section.items.length > 0)
    .map((section) => ({ ...section, data: section.items }));
  const nothingOpen = sections[0].items.length + sections[1].items.length === 0;

  const header = (
    <Stack.Screen
      options={{
        title: t("conditions.title"),
        headerSearchBarOptions: {
          placeholder: t("conditions.searchPlaceholder"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  if (person.error || conditions.error) {
    return (
      <>
        {header}
        <Placeholder
          message={(person.error ?? conditions.error)?.message ?? t("common.error")}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : conditions.refetch())}
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
        sections={shown}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
        ListHeaderComponent={<StatusTips />}
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
            <ConditionStatusIcon status={section.status} size={18} />
            <Text weight="semibold">
              {t(SECTION_TITLE[section.status])} ({section.data.length})
            </Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListFooterComponent={
          shown.length > 0 && nothingOpen ? (
            <View style={{ paddingVertical: space.xl, gap: space.sm, alignItems: "center" }}>
              <Icon icon={CheckCircle2} size={28} tone="success" />
              <Text tone="mutedForeground">{t("conditions.allResolved")}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          conditions.isPending || person.isPending ? (
            <Placeholder busy />
          ) : (
            <View style={{ paddingVertical: space.xl, gap: space.xs, alignItems: "center" }}>
              <Text weight="medium">{t("conditions.noConditions")}</Text>
              <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
                {t("conditions.noConditionsHint")}
              </Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={conditions.isRefetching}
            onRefresh={() => void conditions.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item }) => (
          <ConditionCard
            condition={item}
            onPress={() => router.push(`/health/conditions/${item.id}` as Href)}
          />
        )}
      />
    </>
  );
}

/** The web page's "Справка по статусам": what each status means, folded away until asked. */
function StatusTips() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md }}
      >
        <Icon icon={Info} />
        <Text size="sm" weight="medium" style={{ flex: 1 }}>
          {t("conditions.statusTips.title")}
        </Text>
        <Icon icon={open ? ChevronUp : ChevronDown} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
          {(Object.keys(SECTION_TITLE) as ConditionStatus[]).map((status) => (
            <View key={status} style={{ flexDirection: "row", gap: space.sm }}>
              <ConditionStatusIcon status={status} />
              <Text size="sm" style={{ flex: 1 }}>
                {t(`conditions.statusTips.${status}`)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** The web `ConditionCard`. */
function ConditionCard({
  condition,
  onPress,
}: {
  condition: ConditionWithHistory;
  onPress: () => void;
}) {
  const palette = usePalette();
  const status = condition.current_status;
  const first = condition.first_mentioned_date;
  const last = condition.last_mentioned_date;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor:
          status === "history" ? palette.border : (palette[CONDITION_TONE[status]] as string),
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
        opacity: DIMMED.has(status) ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <ConditionStatusIcon status={status} />
            <Text weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
              {condition.name}
            </Text>
          </View>
          <Text size="xs" tone="mutedForeground" numberOfLines={1}>
            {condition.code
              ? [condition.code, condition.icd_name_en].filter(Boolean).join(" · ")
              : t("conditions.noIcdCode")}
          </Text>
        </View>
        <ConditionStatusBadge status={status} />
      </View>
      {condition.onset_date ? (
        <DateLine icon={Calendar} label={t("conditions.onset")} day={condition.onset_date} />
      ) : null}
      {condition.resolved_date ? (
        <DateLine
          icon={CheckCircle2}
          label={t("conditions.resolvedOn")}
          day={condition.resolved_date}
        />
      ) : null}
      {condition.notes ? (
        <Text size="sm" tone="mutedForeground" numberOfLines={2}>
          {condition.notes}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Icon icon={FileText} size={12} />
          <Text size="xs" tone="mutedForeground">
            {condition.mention_count} {t("conditions.mentions")}
          </Text>
        </View>
        {first ? (
          <Text size="xs" tone="mutedForeground">
            {formatDay(first).slice(3)}
            {last && last !== first ? ` — ${formatDay(last).slice(3)}` : ""}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function DateLine({ icon, label, day }: { icon: typeof Calendar; label: string; day: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Icon icon={icon} size={12} />
      <Text size="sm" tone="mutedForeground">
        {label}: {formatDay(day)}
      </Text>
    </View>
  );
}
