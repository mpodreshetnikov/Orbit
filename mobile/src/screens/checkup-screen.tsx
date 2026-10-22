import type { CheckupItem, CheckupItemStatus, CheckupSchedule } from "@orbit-types/checkup";
import { checkupLateness, isoDay } from "@orbit-types/checkup-summary";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  Bell,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Ellipsis,
  FileText,
  HeartPulse,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Badge, Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import { categoryLabel } from "@/features/checkups/query";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useCheckupAction, useCheckups, useCompletions, usePerson } from "@/lib/queries";
import { CheckupStatusBadge, DateLine } from "@/screens/checkups-screen";
import { radius, space, usePalette } from "@/theme";

/** "Каждый год", "Каждые 3 месяца", "Разовая: 01.11.2026". */
export function scheduleSummary(schedule: CheckupSchedule): string {
  if (schedule.type === "one_off") return `${t("checkups.oneOff")}: ${formatDay(schedule.due_at)}`;
  const count = schedule.every;
  const unit = { week: "unitWeek", month: "unitMonth", year: "unitYear" }[schedule.unit];
  return `${t("checkups.everyWithCount", { count })} ${t(`checkups.${unit}`, { count })}`;
}

/** "7, 3, 1": the reminder days, furthest first, as the web page lists them. */
export function reminderDays(days: number[]): string | null {
  const shown = days.filter((day) => day >= 0).sort((a, b) => b - a);
  return shown.length > 0 ? shown.join(", ") : null;
}

/** What the sheet offers for a status, in the web toolbar's order. */
const STATUS_CHANGES: Record<CheckupItemStatus, [CheckupItemStatus, string][]> = {
  active: [
    ["paused", "checkups.pause"],
    ["archived", "checkups.archive"],
  ],
  paused: [
    ["active", "checkups.resume"],
    ["archived", "checkups.archive"],
  ],
  completed: [],
  archived: [],
};

/**
 * One checkup — the web checkup page: what it is and whether it is late, marked done or planned
 * from here, its schedule, reminders, reason, linked conditions and notes, and every completion,
 * each opened to correct or delete. Pausing, resuming, archiving and deleting are in the bar's
 * sheet.
 */
export default function CheckupScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson();
  const checkups = useCheckups(person.data?.id);
  const completions = useCompletions(id);
  const action = useCheckupAction();
  const item = checkups.data?.find((one) => one.id === id);

  const onError = (error: Error) => Alert.alert(t("common.error"), error.message);
  const actions = (current: CheckupItem) => {
    const changes = STATUS_CHANGES[current.status];
    const labels = [
      ...changes.map(([, label]) => t(label)),
      t("checkups.deleteCheckup"),
      t("common.cancel"),
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: changes.length,
      },
      (index) => {
        const change = changes[index];
        if (change) action.mutate({ item: current, status: change[0] }, { onError });
        else if (index === changes.length) remove(current);
      },
    );
  };
  const remove = (current: CheckupItem) =>
    Alert.alert(t("checkups.deleteCheckup"), t("checkups.deleteCheckupConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("checkups.deleteCheckup"),
        style: "destructive",
        onPress: () =>
          action.mutate(
            { item: current, status: null },
            { onSuccess: () => router.back(), onError },
          ),
      },
    ]);

  const header = (
    <Stack.Screen
      options={{
        title: item?.title ?? "",
        headerLargeTitle: false,
        headerRight: item
          ? () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("common.actions")}: ${item.title}`}
                hitSlop={space.sm}
                onPress={() => actions(item)}
              >
                <Icon icon={Ellipsis} size={22} tone="foreground" />
              </Pressable>
            )
          : undefined,
      }}
    />
  );
  if (!item) {
    const busy = person.isPending || checkups.isPending;
    return (
      <>
        {header}
        <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
      </>
    );
  }

  const late = checkupLateness(item, isoDay(new Date()));
  const reminders = reminderDays(item.reminder_days_before);
  const open = (path: string) => router.push(`/health/checkups/${path}` as Href);

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={checkups.isRefetching}
            onRefresh={() => void Promise.all([checkups.refetch(), completions.refetch()])}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}
        >
          <Text size="sm" tone="mutedForeground">
            {categoryLabel(item.category)}
          </Text>
          <CheckupStatusBadge status={item.status} />
          {late.byDue ? <Badge label={t("checkups.overdue")} textTone="warningText" /> : null}
        </View>
        {item.status === "active" ? (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              style={{ flex: 1 }}
              icon={CheckCircle2}
              label={t("checkups.markComplete")}
              onPress={() => open(`complete?id=${item.id}`)}
            />
            {item.next_due_at ? (
              <Button
                variant="outline"
                icon={CalendarPlus}
                label={t("checkups.plan")}
                onPress={() => open(`plan?id=${item.id}`)}
              />
            ) : null}
          </View>
        ) : null}

        <Card style={{ padding: space.lg, gap: space.md }}>
          <Text weight="semibold">{t("checkups.schedule")}</Text>
          <Text size="sm">{scheduleSummary(item.schedule)}</Text>
          {item.next_due_at ? (
            <DateLine icon={Calendar} label={t("checkups.nextDue")} day={item.next_due_at} />
          ) : null}
          {item.planned_on ? (
            <DateLine icon={CalendarPlus} label={t("checkups.plannedOn")} day={item.planned_on} />
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Icon icon={Bell} size={14} />
            <Text size="xs" tone="mutedForeground" style={{ flex: 1 }}>
              {reminders
                ? `${t("checkups.reminderDaysBeforeLabel")}: ${reminders} ${t("checkups.reminderDaysBeforeSuffix")}`
                : t("checkups.reminderDayOfOnly")}
            </Text>
          </View>
          {item.why_text ? <Labelled label={t("checkups.why")}>{item.why_text}</Labelled> : null}
          {item.why_links.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text size="sm" tone="mutedForeground">
                {t("checkups.linkedConditions")}
              </Text>
              {item.why_links.map((link) => (
                <Pressable
                  key={link.id}
                  accessibilityRole="link"
                  onPress={() => router.push(`/health/conditions/${link.id}` as Href)}
                  style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
                >
                  <Icon icon={HeartPulse} size={14} />
                  <Text size="sm" style={{ flex: 1 }}>
                    {link.label}
                  </Text>
                  <Icon icon={ChevronRight} size={14} />
                </Pressable>
              ))}
            </View>
          ) : null}
          {item.notes ? <Labelled label={t("checkups.notes")}>{item.notes}</Labelled> : null}
        </Card>

        <Card style={{ padding: space.lg, gap: space.md }}>
          <Text weight="semibold">{t("checkups.completionHistory")}</Text>
          {(completions.data ?? []).map((completion) => (
            <Pressable
              key={completion.id}
              accessibilityRole="button"
              onPress={() => open(`complete?id=${item.id}&completion=${completion.id}`)}
              style={({ pressed }) => ({
                gap: 2,
                padding: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: pressed ? palette.mutedHalf : "transparent",
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Icon icon={CheckCircle2} size={14} tone="success" />
                <Text size="sm" weight="medium" style={{ flex: 1 }}>
                  {formatDay(completion.done_at)}
                </Text>
                {completion.evidence_record_id ? (
                  <Badge icon={FileText} label={t("checkups.evidence")} />
                ) : null}
              </View>
              {completion.note ? (
                <Text size="sm" tone="mutedForeground">
                  {completion.note}
                </Text>
              ) : null}
            </Pressable>
          ))}
          {completions.data?.length === 0 ? (
            <Text size="sm" tone="mutedForeground">
              {t("checkups.noCompletions")}
            </Text>
          ) : null}
        </Card>
      </ScrollView>
    </>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text size="sm" tone="mutedForeground">
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </View>
  );
}
