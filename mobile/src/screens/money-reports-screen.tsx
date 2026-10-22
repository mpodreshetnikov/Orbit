import type { MoneyBudgetCategoryNode, MoneyBudgetChartMode } from "@orbit-types/money";
import { MONEY_CURRENCIES } from "@orbit-types/money";
import { formatMoney } from "@orbit-types/money-feed";
import {
  actualForMode,
  currentReportMonth,
  reportMonthLabel,
  shiftReportMonth,
  targetForMode,
} from "@orbit-types/money-reports";
import { Stack, useRouter, type Href } from "expo-router";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { LineChart } from "@/components/charts";
import { Chip, Section } from "@/components/form";
import { Badge, Card, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useBudgetReport, usePerson } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

const MODES: MoneyBudgetChartMode[] = ["expenses", "income", "net"];

const modeLabel = (mode: MoneyBudgetChartMode) =>
  t(`money.reportChartMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);

/**
 * "Отчеты" — the web budget report: a month at a time in a currency, its totals against their
 * targets, the days' spending, the root categories' actual against target, and the category tree,
 * where a category opens its target for the month.
 */
export default function MoneyReportsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const [month, setMonth] = useState(currentReportMonth);
  const [currency, setCurrency] = useState("RUB");
  const [mode, setMode] = useState<MoneyBudgetChartMode>("expenses");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const report = useBudgetReport(person.data?.id, `${month}-01`, currency);
  const money = (value: number) => formatMoney(value, currency, "ru-RU");

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const rows = (nodes: MoneyBudgetCategoryNode[], level = 0): React.ReactNode[] =>
    nodes.flatMap((node) => [
      <CategoryRow
        key={node.id}
        node={node}
        level={level}
        money={money}
        expanded={open.has(node.id)}
        onToggle={() => toggle(node.id)}
        onPress={() =>
          router.push(
            `/money/reports/target?category=${node.id}&month=${month}&currency=${currency}` as Href,
          )
        }
      />,
      ...(open.has(node.id) ? rows(node.children, level + 1) : []),
    ]);

  const data = report.data;
  const roots = (data?.categories ?? [])
    .map((node) => ({ node, actual: actualForMode(node, mode), target: targetForMode(node, mode) }))
    .filter(({ actual, target }) => actual !== 0 || target !== 0);
  const widest = Math.max(1, ...roots.flatMap(({ actual, target }) => [actual, target]));
  const trend = data?.trend ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t("money.reports") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={report.isRefetching}
            onRefresh={() => void report.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.reportPreviousMonth")}
            hitSlop={space.sm}
            onPress={() => setMonth((current) => shiftReportMonth(current, -1))}
          >
            <Icon icon={ChevronLeft} size={22} tone="foreground" />
          </Pressable>
          <Text weight="semibold" style={{ flex: 1, textAlign: "center" }}>
            {reportMonthLabel(month, "ru-RU")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.reportNextMonth")}
            hitSlop={space.sm}
            onPress={() => setMonth((current) => shiftReportMonth(current, 1))}
          >
            <Icon icon={ChevronRight} size={22} tone="foreground" />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {MONEY_CURRENCIES.map((one) => (
            <Chip
              key={one}
              label={one}
              selected={currency === one}
              onPress={() => setCurrency(one)}
            />
          ))}
        </View>

        {!data ? (
          <Placeholder
            busy={person.isPending || report.isPending}
            message={
              report.error ? `${t("money.reportLoadFailed")} ${report.error.message}` : undefined
            }
          />
        ) : (
          <>
            {data.fx_status.mode === "ok" ? null : (
              <Card style={{ padding: space.lg, gap: space.xs }}>
                <Text weight="semibold" tone="warningText">
                  {t(
                    data.fx_status.mode === "missing"
                      ? "money.reportFxMissingTitle"
                      : "money.reportFxApproximateTitle",
                  )}
                </Text>
                <Text size="sm" tone="mutedForeground">
                  {data.fx_status.message ??
                    t(
                      data.fx_status.mode === "missing"
                        ? "money.reportFxMissingBody"
                        : "money.reportFxApproximateBody",
                    )}
                </Text>
              </Card>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {(
                [
                  ["money.reportActualIncome", data.summary.actual_income],
                  ["money.reportActualExpenses", data.summary.actual_expenses],
                  ["money.reportNet", data.summary.actual_net],
                  ["money.reportTargetIncome", data.summary.target_income],
                  ["money.reportTargetExpenses", data.summary.target_expenses],
                  ["money.reportTargetNet", data.summary.target_net],
                  ["money.reportVarianceNet", data.summary.variance_net],
                ] as const
              ).map(([label, value]) => (
                <Card
                  key={label}
                  style={{ padding: space.md, gap: 2, flexBasis: "47%", flexGrow: 1 }}
                >
                  <Text size="xs" tone="mutedForeground">
                    {t(label)}
                  </Text>
                  <Text weight="semibold">{money(value)}</Text>
                </Card>
              ))}
            </View>

            {trend.length > 1 ? (
              <Section title={t("money.reportTrendTitle")}>
                <LineChart
                  values={trend.map((point) => Math.abs(point.expenses))}
                  labels={[trend[0]!.date, trend.at(-1)!.date]}
                  format={money}
                />
              </Section>
            ) : null}

            <Section title={t("money.reportRootComparisonTitle")}>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {MODES.map((one) => (
                  <Chip
                    key={one}
                    label={modeLabel(one)}
                    selected={mode === one}
                    onPress={() => setMode(one)}
                  />
                ))}
              </View>
              {roots.length ? (
                roots.map(({ node, actual, target }) => (
                  <View key={node.id} style={{ gap: 4 }}>
                    <View style={{ flexDirection: "row", gap: space.sm }}>
                      <Text size="sm" style={{ flex: 1 }}>
                        {node.name_en}
                      </Text>
                      <Text size="sm" tone="mutedForeground">
                        {target ? `${money(actual)} / ${money(target)}` : money(actual)}
                      </Text>
                    </View>
                    <View
                      style={{ height: 8, borderRadius: radius.sm, backgroundColor: palette.muted }}
                    >
                      <View
                        style={{
                          width: `${(actual / widest) * 100}%`,
                          height: 8,
                          borderRadius: radius.sm,
                          backgroundColor:
                            target && actual > target ? palette.destructive : palette.primary,
                        }}
                      />
                      {target ? (
                        <View
                          style={{
                            position: "absolute",
                            left: `${(target / widest) * 100}%`,
                            top: -2,
                            width: 2,
                            height: 12,
                            backgroundColor: palette.warning,
                          }}
                        />
                      ) : null}
                    </View>
                  </View>
                ))
              ) : (
                <Text size="sm" tone="mutedForeground">
                  {t("money.reportChartEmpty")}
                </Text>
              )}
            </Section>

            <Section title={t("money.reportCategoriesTitle")}>{rows(data.categories)}</Section>
          </>
        )}
      </ScrollView>
    </>
  );
}

/** A category with its month: what came in and went out, its target, and how far off it is. */
function CategoryRow({
  node,
  level,
  money,
  expanded,
  onToggle,
  onPress,
}: {
  node: MoneyBudgetCategoryNode;
  level: number;
  money: (value: number) => string;
  expanded: boolean;
  onToggle: () => void;
  onPress: () => void;
}) {
  const palette = usePalette();
  const name = node.name_en || node.name_ru;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.xs,
        paddingLeft: level * space.lg,
      }}
    >
      {node.children.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t(expanded ? "common.collapse" : "common.expand")}: ${name}`}
          hitSlop={space.sm}
          onPress={onToggle}
          style={{ paddingTop: 2 }}
        >
          <Icon icon={expanded ? ChevronDown : ChevronRight} size={18} />
        </Pressable>
      ) : (
        <View style={{ width: 18 }} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("money.reportEditTarget")}: ${name}`}
        onPress={onPress}
        style={({ pressed }) => ({ flex: 1, gap: 2, opacity: pressed ? 0.6 : 1 })}
      >
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}
        >
          <Text weight="medium">{name}</Text>
          {node.is_uncategorized ? <Badge label={t("money.reportUncategorizedBadge")} /> : null}
          {node.target ? <Badge label={t("money.reportTargetBadge")} /> : null}
        </View>
        {node.name_ru && node.name_ru !== name ? (
          <Text size="xs" tone="mutedForeground">
            {node.name_ru}
          </Text>
        ) : null}
        <Text size="xs" tone="mutedForeground">
          {`+${money(node.actual_income)} · ${money(node.actual_expenses)} · ${t("money.reportNet")} ${money(node.actual_net)}`}
        </Text>
        {node.target_amount ? (
          <Text
            size="xs"
            style={{
              color:
                node.variance_amount > 0
                  ? palette.success
                  : node.variance_amount < 0
                    ? palette.destructive
                    : palette.mutedForeground,
            }}
          >
            {`${t("money.reportTarget")} ${money(node.target_amount)} · ${t("money.reportVariance")} ${money(node.variance_amount)}`}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}
