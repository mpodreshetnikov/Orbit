import type { CheckupItem } from "@orbit-types/checkup";
import { checkupLateness, groupCheckups, isoDay } from "@orbit-types/checkup-summary";
import type { FindingSummary } from "@orbit-types/finding";
import { Stack, useRouter, type Href } from "expo-router";
import {
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  HeartPulse,
  Ruler,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Sparkline } from "@/components/charts";
import { Input } from "@/components/form";
import { Badge, Button, Card, Icon, Text } from "@/components/ui";
import { categoryLabel } from "@/features/checkups/query";
import { formatDay } from "@/features/measurements/format";
import { chartValues } from "@/features/observations/format";
import { searchRecords } from "@/features/records/query";
import { t } from "@/lib/i18n";
import {
  useCheckups,
  useConditions,
  useFindings,
  useHiddenMeasurements,
  useMeasurements,
  useObservations,
  usePerson,
  useRecords,
} from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";
import { RecordRow } from "./records-screen";

/** How many of the latest documents the hero shows before "Все документы". */
const LATEST = 3;

/** How many overdue / upcoming checkups sit on the hub before "Все". */
const CHECKUP_PREVIEW = 3;

/**
 * "Здоровье" as a view-only dashboard: documents hero with search, Conditions and Findings tiles
 * with chart sparks, a compact checkups strip with mark-done, and secondary read-only entries for
 * observations and measurements. No catalogs, create, or edit.
 */
export default function HealthScreen() {
  return (
    <>
      <Stack.Screen options={{ title: t("nav.health") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <DocumentsHero />
        <OverviewTiles />
        <CheckupsCompact />
        <SecondaryCharts />
      </ScrollView>
    </>
  );
}

/** Documents first: search jumps into the full list with the query kept, latest rows open a document. */
function DocumentsHero() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const records = useRecords(person.data?.id);
  const [query, setQuery] = useState("");
  const failed = person.error ?? records.error;
  const approved = records.data ?? [];
  const filtered = query.trim() ? searchRecords(approved, query, "all") : approved;
  const latest = filtered.slice(0, LATEST);

  const openAll = (search = query) => {
    const trimmed = search.trim();
    router.push(
      (trimmed
        ? { pathname: "/health/records", params: { q: trimmed } }
        : "/health/records") as Href,
    );
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text size="lg" weight="semibold">
          {t("health.documents")}
        </Text>
        <Button
          compact
          variant="ghost"
          label={t("health.allDocuments")}
          onPress={() => openAll("")}
        />
      </View>
      <View style={{ position: "relative", justifyContent: "center" }}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder={t("health.searchDocuments")}
          returnKeyType="search"
          onSubmitEditing={() => openAll()}
          accessibilityLabel={t("health.searchDocuments")}
          style={{ paddingLeft: 40 }}
        />
        <View pointerEvents="none" style={{ position: "absolute", left: space.md }}>
          <Icon icon={Search} size={18} />
        </View>
      </View>
      {failed ? (
        <View style={{ gap: space.sm }}>
          <Text size="sm" tone="destructive">
            {failed.message}
          </Text>
          <Button
            variant="outline"
            compact
            label={t("common.retry")}
            onPress={() => void (person.error ? person.refetch() : records.refetch())}
          />
        </View>
      ) : records.isPending ? (
        <ActivityIndicator color={palette.mutedForeground} />
      ) : latest.length === 0 ? (
        <Text size="sm" tone="mutedForeground">
          {query.trim() ? t("common.noResults") : t("health.noDocuments")}
        </Text>
      ) : (
        latest.map((record) => <RecordRow key={record.id} record={record} />)
      )}
    </View>
  );
}

/** Conditions and Findings as two visual tiles with a spark when a real series exists. */
function OverviewTiles() {
  const person = usePerson();
  const conditions = useConditions(person.data?.id);
  const findings = useFindings(person.data?.id);
  const openConditions = (conditions.data ?? []).filter(
    (row) => row.current_status === "active" || row.current_status === "suspected",
  );
  const activeFindings = (findings.data ?? []).filter((row) => !row.is_resolved);
  // The list RPC has no per-condition temporal series — omit rather than chart mention totals.
  const conditionSpark: number[] = [];
  const findingSpark = findingSparkValues(activeFindings[0] ?? findings.data?.[0]);

  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <DashboardTile
        title={t("conditions.title")}
        accessibilityLabel={t("conditions.title")}
        icon={HeartPulse}
        href="/health/conditions"
        summary={t("health.openConditions", { count: openConditions.length })}
        detail={openConditions[0]?.name}
        spark={conditionSpark}
        busy={conditions.isPending}
        failed={Boolean(conditions.error)}
        errorMessage={conditions.error?.message}
        onRetry={() => void conditions.refetch()}
      />
      <DashboardTile
        title={t("findings.navTitle")}
        accessibilityLabel={t("findings.navTitle")}
        icon={Search}
        href="/health/findings"
        summary={t("health.activeFindings", { count: activeFindings.length })}
        detail={
          activeFindings[0]
            ? activeFindings[0].catalog_finding_name_ru || activeFindings[0].finding_type_text
            : undefined
        }
        spark={findingSpark}
        busy={findings.isPending}
        failed={Boolean(findings.error)}
        errorMessage={findings.error?.message}
        onRetry={() => void findings.refetch()}
      />
    </View>
  );
}

/**
 * Size history of one finding as a sparkline series, oldest first. `summarizeFindings` keeps
 * history newest-first; reverse a copy so growth reads left-to-right.
 */
export function findingSparkValues(finding: FindingSummary | undefined): number[] {
  if (!finding) return [];
  return [...finding.history]
    .reverse()
    .map((point) => point.size_mm)
    .filter((value): value is number => value !== null && value > 0);
}

/** One half-width tile: title, count, optional spark, tap into the list. */
function DashboardTile({
  title,
  accessibilityLabel,
  icon,
  href,
  summary,
  detail,
  spark,
  busy,
  failed,
  errorMessage,
  onRetry,
}: {
  title: string;
  accessibilityLabel: string;
  icon: LucideIcon;
  href: string;
  summary: string;
  detail?: string;
  spark: number[];
  busy?: boolean;
  failed?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}) {
  const palette = usePalette();
  const router = useRouter();
  const shell = {
    flex: 1,
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    minHeight: 128,
  } as const;
  const heading = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Icon icon={icon} size={18} tone="foreground" />
      <Text weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Text>
    </View>
  );
  if (failed) {
    // Not a link: retry must not also navigate into an empty list.
    return (
      <View style={shell} accessibilityLabel={accessibilityLabel}>
        {heading}
        <View style={{ gap: space.sm }}>
          <Text size="sm" tone="destructive" numberOfLines={3}>
            {errorMessage ?? t("common.error")}
          </Text>
          {onRetry ? (
            <Button variant="outline" compact label={t("common.retry")} onPress={onRetry} />
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => router.push(href as Href)}
      style={({ pressed }) => ({
        ...shell,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
      })}
    >
      {heading}
      {busy ? (
        <ActivityIndicator color={palette.mutedForeground} />
      ) : (
        <>
          <Text size="sm" tone="mutedForeground">
            {summary}
          </Text>
          {detail ? (
            <Text size="sm" weight="medium" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          <Sparkline values={spark} />
        </>
      )}
    </Pressable>
  );
}

/** Overdue count, a few current checkups, each with one-tap mark-done. */
function CheckupsCompact() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const checkups = useCheckups(person.data?.id);
  const items = checkups.data ?? [];
  const groups = groupCheckups(items, new Date());
  const imminent = [...groups.overdue, ...groups.upcoming];
  // Prefer overdue/upcoming; if none are imminent, preview later ones rather than "no checkups".
  const preview = (imminent.length > 0 ? imminent : groups.later).slice(0, CHECKUP_PREVIEW);
  const overdue = groups.overdue.length;
  const todayIso = isoDay(new Date());

  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("checkups.navTitle")}
          onPress={() => router.push("/health/checkups" as Href)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Icon icon={CalendarCheck} size={18} tone="foreground" />
          <Text size="lg" weight="semibold" style={{ flex: 1 }}>
            {t("checkups.navTitle")}
          </Text>
        </Pressable>
        {overdue > 0 ? (
          <Badge label={t("health.overdueCheckups", { count: overdue })} textTone="warningText" />
        ) : null}
        <Button
          compact
          variant="ghost"
          label={t("health.allCheckups")}
          onPress={() => router.push("/health/checkups" as Href)}
        />
      </View>
      {checkups.error ? (
        <View style={{ gap: space.sm }}>
          <Text size="sm" tone="destructive">
            {checkups.error.message}
          </Text>
          <Button
            variant="outline"
            compact
            label={t("common.retry")}
            onPress={() => void checkups.refetch()}
          />
        </View>
      ) : checkups.isPending ? (
        <ActivityIndicator color={palette.mutedForeground} />
      ) : preview.length === 0 ? (
        <Card style={{ padding: space.sm }}>
          <Text size="sm" tone="mutedForeground">
            {items.length === 0 ? t("checkups.noItems") : t("today.noCheckups")}
          </Text>
        </Card>
      ) : (
        preview.map((item) => (
          <CheckupPreviewRow
            key={item.id}
            item={item}
            todayIso={todayIso}
            onOpen={() => router.push(`/health/checkups/${item.id}` as Href)}
            onComplete={() => router.push(`/health/checkups/complete?id=${item.id}` as Href)}
          />
        ))
      )}
    </View>
  );
}

/** One-line title + meta with mark-done on the right — denser than a stacked action row. */
function CheckupPreviewRow({
  item,
  todayIso,
  onOpen,
  onComplete,
}: {
  item: CheckupItem;
  todayIso: string;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const palette = usePalette();
  const late = checkupLateness(item, todayIso);
  const overdue = late.byDue || late.byPlan;
  const day = late.byPlan && !late.byDue ? item.planned_on : item.next_due_at;
  const meta = `${categoryLabel(item.category)}${day ? ` · ${formatDay(day)}` : ""}`;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: overdue ? palette.warning : palette.border,
        backgroundColor: palette.card,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${item.title}. ${meta}`}
        onPress={onOpen}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          gap: 1,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text weight="medium" numberOfLines={1}>
          {item.title}
        </Text>
        <Text size="xs" tone="mutedForeground" numberOfLines={1}>
          {meta}
        </Text>
      </Pressable>
      {item.status === "active" ? (
        <Button
          compact
          variant="outline"
          icon={CheckCircle2}
          label={t("checkups.markComplete")}
          accessibilityLabel={`${t("checkups.markComplete")}: ${item.title}`}
          onPress={onComplete}
          style={{ flexShrink: 0, maxWidth: "48%" }}
        />
      ) : null}
    </View>
  );
}

/** Observations and measurements — secondary read-only entries that still carry a spark. */
function SecondaryCharts() {
  const person = usePerson();
  const observations = useObservations(person.data?.id);
  const measurements = useMeasurements(person.data?.id);
  const hidden = useHiddenMeasurements(person.data?.id);
  const topObservation = observations.data?.[0];
  const topMeasurement = (measurements.data ?? []).find((one) => !hidden.codes.has(one.code));
  const observationSpark = topObservation ? chartValues(topObservation.history) : [];
  const measurementSpark = topMeasurement ? topMeasurement.history.map((point) => point.value) : [];

  return (
    <View style={{ gap: space.sm }}>
      <Text size="sm" weight="medium" tone="mutedForeground">
        {t("health.secondaryCharts")}
      </Text>
      <SecondaryRow
        title={t("observationHistory.navTitle")}
        accessibilityLabel={t("observationHistory.navTitle")}
        icon={FlaskConical}
        href="/health/observations"
        hint={
          topObservation ? topObservation.catalog_name_ru || topObservation.obs_name : undefined
        }
        spark={observationSpark}
      />
      <SecondaryRow
        title={t("measurements.title")}
        accessibilityLabel={t("measurements.title")}
        icon={Ruler}
        href="/health/measurements"
        hint={topMeasurement?.name_ru}
        spark={measurementSpark}
      />
    </View>
  );
}

function SecondaryRow({
  title,
  accessibilityLabel,
  icon,
  href,
  hint,
  spark,
}: {
  title: string;
  accessibilityLabel: string;
  icon: LucideIcon;
  href: string;
  hint?: string;
  spark: number[];
}) {
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => router.push(href as Href)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
      })}
    >
      <Icon icon={icon} size={18} tone="foreground" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium">{title}</Text>
        {hint ? (
          <Text size="xs" tone="mutedForeground" numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Sparkline values={spark} />
      <Icon icon={ChevronRight} size={16} />
    </Pressable>
  );
}
