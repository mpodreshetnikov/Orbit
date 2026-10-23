import { Stack, useRouter, type Href } from "expo-router";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreHorizontal,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { showDoseSheet } from "@/components/dose-sheet";
import { statusIcon, unitIcon } from "@/components/medication-icons";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { buildDashboard, type Slot } from "@/features/doses/dashboard";
import { msUntilNextLocalDay } from "@/features/doses/day";
import { doseAmountLabel, doseName, doseUnit, isOpen, type DayDose } from "@/features/doses/model";
import { intakeAdviceLabel } from "@/features/medications/format";
import { t } from "@/lib/i18n";
import { useDayDoses, useDoseAction, usePerson, type DoseAction } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { radius, space, usePalette } from "@/theme";

/** How long a dose acted on stays in place, showing its new state, before it moves to the completed
 * section. The web dashboard's five seconds, restarted by every tap. */
const SETTLE_MS = 5000;

function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

function shiftDay(day: Date, by: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + by);
}

/**
 * The day's doses — the web app's medication dashboard, on the phone.
 *
 * Doses still to take sit at the top in time slots, overdue ones tinted amber, each with "Принято" and
 * a skip cross; a tap answers at once, with a haptic, and the server is told behind it. The day's
 * settled doses fold away below. Arrows step through days, so the past can be corrected and the
 * coming days read; a future day shows its plan but takes no answers, as on the web.
 */
export default function TodayScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { signOut } = useSession();
  const person = usePerson();
  const [today, setToday] = useState(() => startOfDay(new Date()));
  const [offset, setOffset] = useState(0);
  const day = shiftDay(today, offset);
  const doses = useDayDoses(person.data?.id, day);
  const action = useDoseAction();
  const [recentlyActed, setRecentlyActed] = useState<ReadonlySet<string>>(new Set());
  const [completedOpen, setCompletedOpen] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A day ends under a mounted screen in two ways on a phone: backgrounded overnight, or left open
  // past midnight. Both move "today", so the screen does not keep yesterday under today's heading.
  useEffect(() => {
    const refresh = () => setToday(startOfDay(new Date()));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });
    const timer = setTimeout(refresh, msUntilNextLocalDay(new Date()));
    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
  }, [today]);

  useEffect(
    () => () => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
    },
    [],
  );

  const act = useCallback(
    (dose: DayDose, kind: DoseAction) => {
      setRecentlyActed((previous) => new Set(previous).add(dose.id));
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
      settleTimer.current = setTimeout(() => setRecentlyActed(new Set()), SETTLE_MS);
      action.mutate({ dose, action: kind, at: new Date().toISOString() });
    },
    [action],
  );

  const isToday = offset === 0;
  const isFuture = offset > 0;
  const actionable = !isFuture;
  const dashboard = useMemo(
    () => buildDashboard(doses.data ?? [], { now: new Date(), isToday, recentlyActed }),
    [doses.data, isToday, recentlyActed],
  );

  const openCourse = useCallback(
    (dose: DayDose) => router.push(`/today/medication/${dose.regimen_id}` as Href),
    [router],
  );

  const offerActions = useCallback(
    (dose: DayDose) =>
      showDoseSheet(dose, act, {
        actionable,
        extra: [{ label: t("medications.navTitle"), run: () => openCourse(dose) }],
      }),
    [act, actionable, openCourse],
  );

  const dateLabel = day.toLocaleDateString("ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const sectionTitle = isToday
    ? t("medications.todayIntakes")
    : t("medications.intakesForDate", { date: dateLabel });
  const showCompleted = completedOpen || offset < 0;

  const header = (
    <Stack.Screen
      options={{
        title: isToday ? t("medications.dateToday") : dateLabel,
        headerRight: () => (
          <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={space.sm}>
            <Text size="base" tone="mutedForeground">
              {t("auth.signOut")}
            </Text>
          </Pressable>
        ),
      }}
    />
  );

  if (person.error || doses.error) {
    const message = (person.error ?? doses.error)?.message ?? t("common.error");
    return (
      <>
        {header}
        <Placeholder
          message={message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : doses.refetch())}
            />
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={doses.isRefetching}
            onRefresh={() => void doses.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text size="sm" weight="medium" tone="mutedForeground" style={{ flex: 1 }}>
              {person.data ? `${sectionTitle} · ${person.data.name}` : sectionTitle}
            </Text>
            {!isToday ? (
              <Button
                variant="ghost"
                compact
                label={t("medications.dateToday")}
                onPress={() => setOffset(0)}
              />
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Button
              variant="outline"
              icon={ChevronLeft}
              accessibilityLabel={t("medications.datePrev")}
              onPress={() => setOffset((value) => value - 1)}
              style={{ width: 36, minHeight: 36 }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setOffset(0)}
              style={{
                flex: 1,
                minHeight: 36,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: radius.md,
              }}
            >
              <Text size="sm" weight="medium" tabular>
                {dateLabel}
              </Text>
            </Pressable>
            <Button
              variant="outline"
              icon={ChevronRight}
              accessibilityLabel={t("medications.dateNext")}
              onPress={() => setOffset((value) => value + 1)}
              style={{ width: 36, minHeight: 36 }}
            />
          </View>
        </View>

        {doses.isPending ? (
          <Placeholder busy />
        ) : dashboard.pending.length === 0 && dashboard.completedCount === 0 ? (
          <Text size="sm" tone="mutedForeground">
            {isToday
              ? t("medications.noIntakesDueToday")
              : isFuture
                ? t("medications.noIntakesPlannedForDate")
                : t("medications.noIntakesForDate")}
          </Text>
        ) : null}

        {dashboard.pending.map((slot) => (
          <PendingSlot
            key={slot.time}
            slot={slot}
            actionable={actionable}
            overdueIds={dashboard.overdueIds}
            recentlyActed={recentlyActed}
            onAct={act}
            onOpen={openCourse}
          />
        ))}

        {dashboard.completedCount > 0 ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: radius.lg,
              overflow: "hidden",
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => setCompletedOpen((open) => !open)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: space.md,
                paddingVertical: space.md,
                backgroundColor: pressed ? palette.mutedHalf : "transparent",
              })}
            >
              <Text size="sm" weight="medium" tone="mutedForeground">
                {offset < 0
                  ? t("medications.completedOnDate", { date: dateLabel })
                  : t("medications.completedToday")}{" "}
                ({dashboard.completedCount})
              </Text>
              <Icon icon={showCompleted ? ChevronDown : ChevronRight} tone="foreground" />
            </Pressable>
            {showCompleted
              ? dashboard.completed.map((slot) => (
                  <CompletedSlot
                    key={slot.time}
                    slot={slot}
                    onMore={offerActions}
                    onOpen={openCourse}
                  />
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function SlotTime({ time }: { time: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Icon icon={Clock} size={14} />
      <Text size="xs" weight="medium" tone="mutedForeground" tabular>
        {time}
      </Text>
    </View>
  );
}

function PendingSlot({
  slot,
  actionable,
  overdueIds,
  recentlyActed,
  onAct,
  onOpen,
}: {
  slot: Slot;
  actionable: boolean;
  overdueIds: ReadonlySet<string>;
  recentlyActed: ReadonlySet<string>;
  onAct: (dose: DayDose, action: DoseAction) => void;
  onOpen: (dose: DayDose) => void;
}) {
  const palette = usePalette();
  const open = slot.doses.filter((dose) => isOpen(dose.status) || dose.status === "missed");
  return (
    <View style={{ backgroundColor: palette.card, borderRadius: radius.lg, gap: 6 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.xs,
        }}
      >
        <SlotTime time={slot.time} />
        {actionable && open.length > 1 ? (
          <Button
            variant="secondary"
            compact
            icon={Check}
            label={t("medications.confirmAll")}
            onPress={() => open.forEach((dose) => onAct(dose, "take"))}
          />
        ) : null}
      </View>
      {slot.doses.map((dose) => {
        const justActed = recentlyActed.has(dose.id);
        const overdue = overdueIds.has(dose.id);
        const taken = dose.status === "taken";
        const advice = intakeAdviceLabel(dose.regimen);
        const settledLabel =
          dose.status === "taken"
            ? `${t("medications.taken")} — ${doseAmountLabel(dose)}`
            : dose.status === "skipped"
              ? t("medications.skipped")
              : null;
        const status = statusIcon(dose.status);
        return (
          <View
            key={dose.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingVertical: 6,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              borderWidth: overdue || (taken && justActed) ? 1 : 0,
              borderColor: overdue ? palette.warningBorder : palette.successBorder,
              backgroundColor: overdue
                ? palette.warningSurface
                : taken && justActed
                  ? palette.successSurface
                  : palette.mutedHalf,
            }}
          >
            <Icon icon={unitIcon(doseUnit(dose))} />
            <Pressable style={{ flex: 1 }} onPress={() => onOpen(dose)} accessibilityRole="link">
              <Text size="sm" weight="medium" numberOfLines={1}>
                {doseName(dose)}
              </Text>
              <Text size="xs" tone="mutedForeground">
                {overdue && !justActed ? (
                  <Text size="xs" weight="medium" tone="warning">
                    {t("medications.overdue")} ·{" "}
                  </Text>
                ) : null}
                {justActed && settledLabel ? settledLabel : doseAmountLabel(dose)}
                {advice ? ` · ${advice}` : ""}
              </Text>
            </Pressable>
            {actionable && !justActed ? (
              <View style={{ flexDirection: "row", gap: space.xs }}>
                <Button
                  variant="ghost"
                  compact
                  icon={X}
                  accessibilityLabel={t("medications.skipped")}
                  onPress={() => onAct(dose, "skip")}
                />
                <Button
                  compact
                  icon={Check}
                  label={t("medications.taken")}
                  onPress={() => onAct(dose, "take")}
                />
              </View>
            ) : null}
            {justActed ? <Icon icon={status.icon} tone={status.tone} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function CompletedSlot({
  slot,
  onMore,
  onOpen,
}: {
  slot: Slot;
  onMore: (dose: DayDose) => void;
  onOpen: (dose: DayDose) => void;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: palette.border,
        backgroundColor: palette.mutedHalf,
      }}
    >
      <View style={{ paddingHorizontal: space.md, paddingVertical: 6 }}>
        <SlotTime time={slot.time} />
      </View>
      {slot.doses.map((dose) => {
        const status = statusIcon(dose.status);
        const advice = intakeAdviceLabel(dose.regimen);
        const label =
          dose.status === "taken"
            ? `${t("medications.taken")} — ${doseAmountLabel(dose)}`
            : dose.status === "skipped"
              ? t("medications.skipped")
              : t("medications.unspecified");
        return (
          <Pressable
            key={dose.id}
            onPress={() => onOpen(dose)}
            onLongPress={() => onMore(dose)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: 6,
              backgroundColor: pressed
                ? palette.muted
                : dose.status === "taken"
                  ? palette.successSurface
                  : "transparent",
            })}
          >
            <Icon icon={unitIcon(doseUnit(dose))} />
            <View style={{ flex: 1 }}>
              <Text size="sm" weight="medium" numberOfLines={1}>
                {doseName(dose)}
              </Text>
              <Text size="xs" tone="mutedForeground">
                {label}
                {advice ? ` · ${advice}` : ""}
              </Text>
            </View>
            <Icon icon={status.icon} tone={status.tone} />
            <Button
              variant="ghost"
              compact
              icon={MoreHorizontal}
              accessibilityLabel={t("common.actions")}
              onPress={() => onMore(dose)}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
