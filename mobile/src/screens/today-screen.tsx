import type { CheckupItem } from "@orbit-types/checkup";
import { checkupLateness, groupCheckups, isoDay } from "@orbit-types/checkup-summary";
import { Stack, useRouter, type Href } from "expo-router";
import { ChevronRight, Settings, Wallet } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { PendingSlot } from "@/components/dose-slots";
import { Badge, Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import { categoryLabel } from "@/features/checkups/query";
import { buildDashboard } from "@/features/doses/dashboard";
import type { DayDose } from "@/features/doses/model";
import { useSettledDoses } from "@/features/doses/use-settled";
import { useToday } from "@/features/doses/use-today";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useCheckups, useDayDoses, useDoseAction, usePerson, useTodayBlocks } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/**
 * "Сегодня": what today asks of the person, gathered from the other tabs in blocks — the doses still
 * to take and the checkups that are late or due within the week. Each block answers in place where it
 * can and leads to its own tab for the rest. Which blocks show is chosen in the settings.
 */
export default function TodayScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const blocks = useTodayBlocks();
  const today = useToday();
  const shown = blocks.data;
  const doses = useDayDoses(shown?.doses ? person.data?.id : undefined, today);
  const checkups = useCheckups(shown?.checkups ? person.data?.id : undefined);

  const header = (
    <Stack.Screen
      options={{
        title: t("today.title"),
        headerLeft: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.addTransaction")}
            hitSlop={space.sm}
            onPress={() => router.push("/today/spend" as Href)}
          >
            <Icon icon={Wallet} size={22} tone="foreground" />
          </Pressable>
        ),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("nav.settings")}
            hitSlop={space.sm}
            onPress={() => router.push("/today/settings" as Href)}
          >
            <Icon icon={Settings} size={22} tone="foreground" />
          </Pressable>
        ),
      }}
    />
  );

  if (person.error) {
    return (
      <>
        {header}
        <Placeholder
          message={person.error.message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void person.refetch()}
            />
          }
        />
      </>
    );
  }

  const dateLabel = today.toLocaleDateString("ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const none = shown && !shown.doses && !shown.checkups;

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={doses.isRefetching || checkups.isRefetching}
            onRefresh={() => {
              if (shown?.doses) void doses.refetch();
              if (shown?.checkups) void checkups.refetch();
            }}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <Text size="sm" weight="medium" tone="mutedForeground">
          {person.data ? `${dateLabel} · ${person.data.name}` : dateLabel}
        </Text>
        {!shown ? <Placeholder busy /> : null}
        {none ? (
          <Placeholder
            message={`${t("today.noBlocks")}. ${t("today.noBlocksHint")}.`}
            action={
              <Button
                variant="outline"
                label={t("nav.settings")}
                onPress={() => router.push("/today/settings" as Href)}
              />
            }
          />
        ) : null}
        {shown?.doses ? <DosesBlock doses={doses} /> : null}
        {shown?.checkups ? <CheckupsBlock checkups={checkups} /> : null}
      </ScrollView>
    </>
  );
}

/** A block of "Сегодня": its heading, a way to its whole tab, and what it holds for today. */
function Block({
  title,
  onAll,
  children,
}: {
  title: string;
  onAll: () => void;
  children: ReactNode;
}) {
  return (
    <Card style={{ padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text weight="semibold" style={{ flex: 1 }}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${title}: ${t("today.showAll")}`}
          hitSlop={space.sm}
          onPress={onAll}
          style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
        >
          <Text size="sm" tone="primary">
            {t("today.showAll")}
          </Text>
          <Icon icon={ChevronRight} size={16} tone="primary" />
        </Pressable>
      </View>
      {children}
    </Card>
  );
}

/** Retry inside a block, so one failed read does not take the others down with it. */
function BlockError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text size="sm" tone="destructive">
        {message}
      </Text>
      <Button variant="outline" compact label={t("common.retry")} onPress={onRetry} />
    </View>
  );
}

/** Today's doses still to take, answered in place; the day's settled ones are only counted. */
function DosesBlock({ doses }: { doses: ReturnType<typeof useDayDoses> }) {
  const router = useRouter();
  const action = useDoseAction();
  const { recentlyActed, act } = useSettledDoses(action);
  const dashboard = useMemo(
    () => buildDashboard(doses.data ?? [], { now: new Date(), isToday: true, recentlyActed }),
    [doses.data, recentlyActed],
  );
  const total = doses.data?.length ?? 0;
  // Counted from what was answered, not from the dashboard's grouping: a past one-off left
  // unanswered folds away there but is not done.
  const answered = (doses.data ?? []).filter(
    (dose) => dose.status === "taken" || dose.status === "skipped",
  ).length;
  const open = (dose: DayDose) => router.push(`/today/medication/${dose.regimen_id}` as Href);

  return (
    <Block title={t("medications.todayIntakes")} onAll={() => router.push("/medications" as Href)}>
      {doses.error ? (
        <BlockError message={doses.error.message} onRetry={() => void doses.refetch()} />
      ) : doses.isPending ? (
        <Placeholder busy />
      ) : total === 0 ? (
        <Text size="sm" tone="mutedForeground">
          {t("medications.noIntakesDueToday")}
        </Text>
      ) : (
        <>
          {dashboard.pending.map((slot) => (
            <PendingSlot
              key={slot.time}
              slot={slot}
              actionable
              overdueIds={dashboard.overdueIds}
              recentlyActed={recentlyActed}
              onAct={act}
              onOpen={open}
            />
          ))}
          <Text size="xs" tone="mutedForeground">
            {answered === total
              ? t("today.allDone")
              : t("today.answered", { done: answered, total })}
          </Text>
        </>
      )}
    </Block>
  );
}

/** Checkups that are late or due within the week, overdue first; each opens its checkup. */
function CheckupsBlock({ checkups }: { checkups: ReturnType<typeof useCheckups> }) {
  const palette = usePalette();
  const router = useRouter();
  const now = new Date();
  const groups = groupCheckups(checkups.data ?? [], now);
  const items: CheckupItem[] = [...groups.overdue, ...groups.upcoming];
  const todayIso = isoDay(now);

  return (
    <Block title={t("today.checkups")} onAll={() => router.push("/health/checkups" as Href)}>
      {checkups.error ? (
        <BlockError message={checkups.error.message} onRetry={() => void checkups.refetch()} />
      ) : checkups.isPending ? (
        <Placeholder busy />
      ) : items.length === 0 ? (
        <Text size="sm" tone="mutedForeground">
          {t("today.noCheckups")}
        </Text>
      ) : (
        items.map((item) => {
          const late = checkupLateness(item, todayIso);
          const overdue = late.byDue || late.byPlan;
          const day = late.byPlan && !late.byDue ? item.planned_on : item.next_due_at;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="link"
              onPress={() => router.push(`/health/checkups/${item.id}` as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingVertical: 6,
                paddingHorizontal: space.sm,
                borderRadius: radius.sm,
                borderWidth: overdue ? 1 : 0,
                borderColor: palette.warningBorder,
                backgroundColor: pressed
                  ? palette.muted
                  : overdue
                    ? palette.warningSurface
                    : palette.mutedHalf,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text size="sm" weight="medium" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text size="xs" tone="mutedForeground" numberOfLines={1}>
                  {categoryLabel(item.category)}
                  {day ? ` · ${t("checkups.dueDate")}: ${formatDay(day)}` : ""}
                </Text>
              </View>
              {late.byDue ? (
                <Badge label={t("checkups.overdue")} textTone="warningText" />
              ) : late.byPlan ? (
                <Badge label={t("checkups.plannedOverdue")} textTone="primary" />
              ) : null}
              <Icon icon={ChevronRight} size={16} />
            </Pressable>
          );
        })
      )}
    </Block>
  );
}
