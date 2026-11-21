import { niceAxisTicks } from "@orbit-types/money-report-axis-ticks";
import { formatChange, percentChange } from "@orbit-types/money-report-change";
import { transactionsFeedQuery } from "@orbit-types/money-report-feed-query";
import {
  amountOf,
  changeTone,
  childCategories,
  formatReportAmount,
  isoDay,
  lastYearOf,
  periodContaining,
  periodLabel,
  previousOf,
  shiftPeriod,
  squarify,
  topCategories,
  treemapShade,
  type SpendingCategory,
  type SpendingPeriod,
  type SpendingPeriodKind,
  type SpendingReportMode,
} from "@orbit-types/money-spending-report";
import type { SpendingMerchant, SpendingReport } from "@orbit-types/money-spending-report-ux";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useRouter, type Href } from "expo-router";
import { ChevronDown, ChevronLeft, ChevronRight, Filter, X } from "lucide-react-native";
import { useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  useColorScheme,
  View,
  type ColorSchemeName,
} from "react-native";
import { Chip, Field, Segmented } from "@/components/form";
import { Button, Card, Icon, Placeholder, Text } from "@/components/ui";
import { dayOf } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useMoneyAccounts, usePerson, useSpendingReport } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

const LOCALE = "ru-RU";
const CURRENCY = "RUB";
const LIST_TOP_N = 10;

/**
 * The report's own colours, the web page's Tailwind shades: orange for spending, teal for income,
 * the same pair for a change that is bad or good news. Light first, then dark.
 */
const COLORS = {
  tone: {
    good: ["#115e59", "#5eead4"], // teal-800 / teal-300
    bad: ["#9a3412", "#fdba74"], // orange-800 / orange-300
  },
  tile: {
    expense: {
      strong: ["#9a3412", "#ffffff"], // orange-800, white
      medium: ["#ea580c", "#ffffff"], // orange-600
      light: ["#fed7aa", "#431407"], // orange-200, orange-950
    },
    income: {
      strong: ["#115e59", "#ffffff"], // teal-800
      medium: ["#0d9488", "#ffffff"], // teal-600
      light: ["#99f6e4", "#042f2e"], // teal-200, teal-950
    },
  },
  bar: { expense: "#ea580c", income: "#0d9488" },
} as const;

const toneColor = (tone: "good" | "bad", scheme: ColorSchemeName | null) =>
  COLORS.tone[tone][scheme === "dark" ? 1 : 0];

const money = (amount: number) => formatReportAmount(amount, CURRENCY, LOCALE);

const categoryName = (category: Pick<SpendingCategory, "name_ru" | "name_en" | "direct">) => {
  const name = category.name_ru || category.name_en;
  return category.direct ? t("money.spendingDirect", { name }) : name;
};

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const PERIOD_KINDS: [SpendingPeriodKind, string][] = [
  ["week", "money.spendingPeriodWeek"],
  ["month", "money.spendingPeriodMonth"],
  ["last30", "money.spendingPeriodLast30"],
  ["custom", "money.spendingPeriodCustom"],
];

/** A day picked in the system date picker, as the report's `YYYY-MM-DD`. */
const fromPicker = (date: Date) => dayOf(date);
const toPicker = (day: string) => new Date(`${day}T12:00:00`);

/**
 * "Отчёт" (T-261028-yhm), the web report laid out for the phone: the period, accounts and a
 * category filter on top, spending, income and net with their changes and a forecast, a treemap
 * of categories that drills down, the list that opens a category and filters the report by it,
 * the days and the top merchants.
 */
export default function MoneyReportsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const person = usePerson();
  const personId = person.data?.id;
  const accounts = useMoneyAccounts(personId);
  const [period, setPeriod] = useState<SpendingPeriod>(() =>
    periodContaining("month", isoDay(new Date())),
  );
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [mode, setMode] = useState<SpendingReportMode>("expense");
  const [mapParentId, setMapParentId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllMerchants, setShowAllMerchants] = useState(false);
  const report = useSpendingReport({
    personId,
    period,
    currency: CURRENCY,
    accountIds,
    categoryId,
    brandId,
    merchantName,
  });
  const data = report.data;

  const filterBy = (id: string | null) => {
    setCategoryId(id);
    setMapParentId(null);
    setOpen(new Set());
    setShowAllCategories(false);
  };
  const filterByMerchant = (merchant: SpendingMerchant | null) => {
    setMerchantName(merchant?.name ?? null);
    setBrandId(merchant?.brand_id ?? null);
    setShowAllMerchants(false);
  };
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const choosePeriod = (kind: SpendingPeriodKind) =>
    setPeriod(kind === "custom" ? { ...period, kind } : periodContaining(kind, isoDay(new Date())));
  const setCustom = (edge: "start" | "end", day: string) =>
    setPeriod((current) => {
      const next = { ...current, [edge]: day };
      // A range turned inside out takes the other end with it, so it is never empty.
      return next.start <= next.end ? next : { ...next, start: day, end: day };
    });

  const all = data?.categories ?? [];
  const filter = all.find((one) => one.id === categoryId) ?? null;
  const allListed = data ? topCategories(all, categoryId, mode) : [];
  const listed = showAllCategories ? allListed : allListed.slice(0, LIST_TOP_N);
  const mapParent = all.find((one) => one.id === mapParentId) ?? null;
  const mapped = mapParent ? childCategories(all, mapParent.id, mode) : allListed;

  return (
    <>
      <Stack.Screen options={{ title: t("money.spendingTitle") }} />
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
        <Segmented
          options={PERIOD_KINDS.map(([kind, key]) => [kind, t(key)])}
          value={period.kind}
          onChange={choosePeriod}
        />
        {period.kind === "custom" ? (
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Field label={t("money.spendingCustomFrom")}>
              <DateTimePicker
                testID="spending-from"
                value={toPicker(period.start)}
                mode="date"
                display="compact"
                locale="ru"
                style={{ alignSelf: "flex-start" }}
                onValueChange={(_event, picked) => setCustom("start", fromPicker(picked))}
              />
            </Field>
            <Field label={t("money.spendingCustomTo")}>
              <DateTimePicker
                testID="spending-to"
                value={toPicker(period.end)}
                mode="date"
                display="compact"
                locale="ru"
                style={{ alignSelf: "flex-start" }}
                onValueChange={(_event, picked) => setCustom("end", fromPicker(picked))}
              />
            </Field>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.spendingPrevious")}
            hitSlop={space.sm}
            onPress={() => setPeriod((current) => shiftPeriod(current, -1))}
          >
            <Icon icon={ChevronLeft} size={22} tone="foreground" />
          </Pressable>
          <Text weight="semibold" style={{ flex: 1, textAlign: "center" }}>
            {capitalized(periodLabel(period, LOCALE))}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.spendingNext")}
            hitSlop={space.sm}
            onPress={() => setPeriod((current) => shiftPeriod(current, 1))}
          >
            <Icon icon={ChevronRight} size={22} tone="foreground" />
          </Pressable>
        </View>
        {(accounts.data?.length ?? 0) > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
          >
            <Chip
              label={t("money.spendingAllAccounts")}
              selected={accountIds.length === 0}
              onPress={() => setAccountIds([])}
            />
            {accounts.data!.map((account) => {
              const selected = accountIds.includes(account.id);
              return (
                <Chip
                  key={account.id}
                  label={account.account_label}
                  selected={selected}
                  onPress={() =>
                    setAccountIds((current) =>
                      selected
                        ? current.filter((id) => id !== account.id)
                        : [...current, account.id],
                    )
                  }
                />
              );
            })}
          </ScrollView>
        ) : null}

        <Pressable
          testID="spending-view-transactions"
          accessibilityRole="link"
          onPress={() =>
            router.push(
              `/money?${transactionsFeedQuery({
                start: period.start,
                end: period.end,
                accountIds,
                categoryId,
                merchantName,
                mode,
              })}` as Href,
            )
          }
        >
          <Text size="sm" tone="mutedForeground" style={{ textDecorationLine: "underline" }}>
            {t("money.spendingViewTransactionsShort")}
          </Text>
        </Pressable>

        {categoryId || merchantName ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {categoryId ? (
              <FilterChip
                label={
                  filter
                    ? t("money.spendingFilterChip", { name: categoryName(filter) })
                    : t("money.spendingFilterUnnamed")
                }
                onClear={() => filterBy(null)}
              />
            ) : null}
            {merchantName ? (
              <FilterChip
                label={t("money.spendingFilterChipMerchant", { name: merchantName })}
                onClear={() => filterByMerchant(null)}
              />
            ) : null}
          </View>
        ) : null}

        {!data ? (
          <Placeholder
            busy={person.isPending || report.isPending}
            message={report.error ? t("money.spendingLoadFailed") : undefined}
          />
        ) : (
          <>
            {data.fx_status.status === "ok" ? null : (
              <Card style={{ padding: space.lg }}>
                <Text size="sm" tone="warningText">
                  {data.fx_status.status === "error"
                    ? t("money.spendingFxMissing", { pairs: data.fx_status.missing.join(", ") })
                    : t("money.spendingFxApproximate")}
                </Text>
              </Card>
            )}
            <Totals report={data} />

            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
                  {t("money.spendingCategories")}
                </Text>
                <View style={{ width: 180 }}>
                  <Segmented
                    options={[
                      ["expense", t("money.spendingExpense")],
                      ["income", t("money.spendingIncome")],
                    ]}
                    value={mode}
                    onChange={(next) => {
                      setMode(next);
                      setMapParentId(null);
                      setShowAllCategories(false);
                    }}
                  />
                </View>
              </View>
              <Text size="xs" tone="mutedForeground" numberOfLines={1}>
                {t("money.spendingCompareLegend", { year: String(data.period.last_year) })}
              </Text>
              {mapParent ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setMapParentId(
                      mapParent.parent_id && mapParent.parent_id !== categoryId
                        ? mapParent.parent_id
                        : null,
                    )
                  }
                >
                  <Text size="sm">
                    <Text size="sm" style={{ textDecorationLine: "underline" }}>
                      {filter ? categoryName(filter) : t("money.spendingAllCategories")}
                    </Text>
                    {` › ${categoryName(mapParent)}`}
                  </Text>
                </Pressable>
              ) : null}
              <Text size="xs" tone="mutedForeground">
                {t("money.spendingCategoriesHintTouch")}
              </Text>
              {mapped.length ? (
                <CategoryMap
                  categories={mapped}
                  mode={mode}
                  onOpen={(category) =>
                    category.has_children && childCategories(all, category.id, mode).length
                      ? setMapParentId(category.id)
                      : filterBy(category.id)
                  }
                />
              ) : (
                <Text size="sm" tone="mutedForeground" style={{ paddingVertical: space.xl }}>
                  {t("money.spendingEmpty")}
                </Text>
              )}
            </View>

            {listed.length ? (
              <View style={{ gap: space.sm }}>
                <Card style={{ paddingVertical: space.xs }}>
                  {listed.map((category, index) => (
                    <CategoryRow
                      key={category.id}
                      category={category}
                      subcategories={
                        category.has_children ? childCategories(all, category.id, mode) : []
                      }
                      total={listed.reduce((sum, one) => sum + amountOf(one, mode), 0)}
                      mode={mode}
                      first={index === 0}
                      open={open.has(category.id)}
                      onToggle={() => toggle(category.id)}
                      onFilter={() => filterBy(category.id)}
                    />
                  ))}
                </Card>
                {allListed.length > LIST_TOP_N ? (
                  <Button
                    label={
                      showAllCategories ? t("money.spendingShowTop") : t("money.spendingShowAll")
                    }
                    variant="ghost"
                    compact
                    onPress={() => setShowAllCategories((current) => !current)}
                  />
                ) : null}
              </View>
            ) : null}

            <Days report={data} mode={mode} />
            <Merchants
              report={data}
              showAll={showAllMerchants}
              onShowAll={setShowAllMerchants}
              onSelect={filterByMerchant}
            />
          </>
        )}
      </ScrollView>
    </>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: space.md,
        paddingRight: space.xs,
        paddingVertical: space.xs,
        borderRadius: 999,
        backgroundColor: palette.foreground,
      }}
    >
      <Text size="sm" tone="background">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("money.spendingClearFilter")}
        hitSlop={space.sm}
        onPress={onClear}
        style={{ padding: 4, borderRadius: 999, backgroundColor: palette.mutedForeground }}
      >
        <Icon icon={X} size={12} tone="background" />
      </Pressable>
    </View>
  );
}

/** Compact change badge (▲ 8% / новое); basis lives in a once-per-section legend. */
function Change({
  value,
  base,
  mode,
}: {
  value: number;
  base: number;
  mode: SpendingReportMode | "net";
}) {
  const scheme = useColorScheme();
  const palette = usePalette();
  const change = percentChange(value, base);
  const newLabel = t("money.spendingChangeNew");
  const text = formatChange(change, { value, base, newLabel });
  const tone = changeTone(change, mode);
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radius.sm,
        backgroundColor:
          tone === "neutral"
            ? palette.muted
            : tone === "good"
              ? "rgba(20, 184, 166, 0.12)"
              : "rgba(249, 115, 22, 0.12)",
      }}
    >
      <Text
        size="xs"
        tone="mutedForeground"
        numberOfLines={1}
        style={tone === "neutral" ? undefined : { color: toneColor(tone, scheme) }}
      >
        {text ?? "—"}
      </Text>
    </View>
  );
}

/** Spending, income and net side by side; forecast as one calm line under each figure. */
function Totals({ report }: { report: SpendingReport }) {
  const scheme = useColorScheme();
  const { totals, forecast, period } = report;
  const year = String(period.last_year);
  const end = forecast
    ? new Intl.DateTimeFormat(LOCALE, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${period.end}T00:00:00Z`))
    : "";
  const cards = [
    {
      key: "expense" as const,
      title: "money.spendingExpense",
      value: totals.expense,
      previous: totals.previous_expense,
      lastYear: totals.last_year_expense,
      forecast: forecast?.expense,
      testId: "spending-forecast",
    },
    {
      key: "income" as const,
      title: "money.spendingIncome",
      value: totals.income,
      previous: totals.previous_income,
      lastYear: totals.last_year_income,
      forecast: forecast?.income,
      testId: "spending-forecast-income",
    },
    {
      key: "net" as const,
      title: "money.spendingNet",
      value: totals.net,
      previous: totals.previous_net,
      lastYear: totals.last_year_net,
      forecast: forecast?.net,
      testId: "spending-forecast-net",
    },
  ];
  return (
    <View style={{ gap: space.sm }}>
      <Text size="xs" tone="mutedForeground" numberOfLines={1}>
        {t("money.spendingCompareLegend", { year })}
      </Text>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {cards.map((card) => (
          <Card
            key={card.key}
            testID={`spending-total-${card.key}`}
            style={{ flex: 1, padding: space.md, gap: 2, overflow: "hidden" }}
          >
            <Text size="xs" tone="mutedForeground" numberOfLines={1}>
              {t(card.title)}
            </Text>
            <Text
              weight="bold"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={
                card.key === "net" && card.value > 0
                  ? { color: toneColor("good", scheme) }
                  : undefined
              }
            >
              {`${card.key === "net" && card.value > 0 ? "+" : ""}${money(card.value)}`}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              <Change value={card.value} base={card.previous} mode={card.key} />
              <Change value={card.value} base={card.lastYear} mode={card.key} />
            </View>
          </Card>
        ))}
      </View>
      {forecast ? (
        <Text size="xs" tone="mutedForeground" numberOfLines={1}>
          <Text size="xs" tone="mutedForeground" testID="spending-forecast">
            {t("money.spendingForecastLine", { date: end, amount: money(forecast.expense) })}
          </Text>
          <Text size="xs" tone="mutedForeground" testID="spending-forecast-income">
            {` · ≈${money(forecast.income)}`}
          </Text>
          <Text
            size="xs"
            testID="spending-forecast-net"
            style={
              forecast.net > 0
                ? { color: toneColor("good", scheme) }
                : forecast.net < 0
                  ? { color: toneColor("bad", scheme) }
                  : undefined
            }
          >
            {` · ≈${forecast.net > 0 ? "+" : ""}${money(forecast.net)}`}
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The categories as a square treemap, each tile in proportion to its amount and shaded by rank. A
 * tile with subcategories opens them; one without filters the report by it.
 */
function CategoryMap({
  categories,
  mode,
  onOpen,
}: {
  categories: SpendingCategory[];
  mode: SpendingReportMode;
  onOpen: (category: SpendingCategory) => void;
}) {
  const palette = usePalette();
  const total = categories.reduce((sum, category) => sum + amountOf(category, mode), 0);
  const tiles = squarify(categories, (category) => amountOf(category, mode), 1);
  return (
    <View testID="spending-treemap" style={{ width: "100%", aspectRatio: 1 }}>
      {tiles.map((tile, rank) => {
        const category = tile.item;
        const amount = amountOf(category, mode);
        const share = total > 0 ? Math.round((amount / total) * 100) : 0;
        const [background, foreground] = COLORS.tile[mode][treemapShade(rank, tiles.length)];
        const roomy = tile.width > 0.22 && tile.height > 0.16;
        const tiny = tile.width < 0.14 || tile.height < 0.08;
        const name = categoryName(category);
        return (
          <Pressable
            key={category.id}
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${money(amount)}, ${share}%`}
            onPress={() => onOpen(category)}
            style={{
              position: "absolute",
              left: `${tile.x * 100}%`,
              top: `${tile.y * 100}%`,
              width: `${tile.width * 100}%`,
              height: `${tile.height * 100}%`,
              padding: 6,
              overflow: "hidden",
              borderRadius: radius.lg,
              borderWidth: 2,
              borderColor: palette.background,
              borderStyle: category.system_key === "uncategorized" ? "dashed" : "solid",
              backgroundColor: background,
            }}
          >
            {tiny ? null : (
              <Text size="xs" weight="semibold" style={{ color: foreground }}>
                {name}
              </Text>
            )}
            {roomy ? (
              <Text size="xs" style={{ color: foreground }}>
                {`${money(amount)} · ${share}%`}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Twelve month bars; a tap shows the month and amount. */
function Sparkline({ category, mode }: { category: SpendingCategory; mode: SpendingReportMode }) {
  const palette = usePalette();
  const values = category.months.map((month) => (mode === "income" ? month.income : month.expense));
  const max = Math.max(...values, 0);
  const monthLabel = new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <View
      testID={`spending-sparkline-${category.id}`}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 24 }}
    >
      {values.map((value, index) => {
        const month = category.months[index]?.month_start;
        const label = t("money.spendingMonthTooltip", {
          month: month ? monthLabel.format(new Date(`${month}T00:00:00Z`)) : String(index + 1),
          amount: money(value),
        });
        return (
          <Pressable
            key={month ?? index}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => Alert.alert(label)}
            style={{
              width: 6,
              height: max > 0 ? Math.max(2, (value / max) * 24) : 2,
              borderRadius: 2,
              backgroundColor:
                index === values.length - 1 ? COLORS.bar[mode] : palette.mutedForeground,
              opacity: index === values.length - 1 ? 1 : 0.35,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * A category in the list: its amount and share, its changes under the name. A tap opens its
 * subcategories and the button that narrows the whole report to it.
 */
function CategoryRow({
  category,
  subcategories,
  total,
  mode,
  first,
  open,
  onToggle,
  onFilter,
}: {
  category: SpendingCategory;
  subcategories: SpendingCategory[];
  total: number;
  mode: SpendingReportMode;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  onFilter: () => void;
}) {
  const palette = usePalette();
  const amount = amountOf(category, mode);
  const name = categoryName(category);
  return (
    <View
      testID={`spending-row-${category.id}`}
      style={{ borderTopWidth: first ? 0 : 1, borderColor: palette.border }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t(open ? "money.spendingCollapse" : "money.spendingExpand", { name })}
        onPress={onToggle}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Icon icon={open ? ChevronDown : ChevronRight} size={16} />
            <Text weight="medium" numberOfLines={1} style={{ flex: 1 }}>
              {name}
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            <Change value={amount} base={previousOf(category, mode)} mode={mode} />
            <Change value={amount} base={lastYearOf(category, mode)} mode={mode} />
          </View>
          {category.months.length ? <Sparkline category={category} mode={mode} /> : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text weight="semibold">{money(amount)}</Text>
          <Text size="xs" tone="mutedForeground">
            {total > 0 ? `${Math.round((amount / total) * 100)}%` : ""}
          </Text>
        </View>
      </Pressable>
      {open ? (
        <View style={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
          {subcategories.map((child) => (
            <View key={child.id} style={{ flexDirection: "row", paddingLeft: space.lg }}>
              <Text size="sm" tone="mutedForeground" style={{ flex: 1 }}>
                {categoryName(child)}
              </Text>
              <Text size="sm" tone="mutedForeground">
                {money(amountOf(child, mode))}
              </Text>
            </View>
          ))}
          <Button
            label={t("money.spendingFilterByCategory", { name })}
            icon={Filter}
            onPress={onFilter}
          />
        </View>
      ) : null}
    </View>
  );
}

/** One bar a day with a rounded Y axis; a tap shows the date and amount. */
function Days({ report, mode }: { report: SpendingReport; mode: SpendingReportMode }) {
  const palette = usePalette();
  const today = isoDay(new Date());
  const values = report.days.map((day) => (mode === "income" ? day.income : day.expense));
  const max = Math.max(...values, 0);
  const ticks = niceAxisTicks(max);
  const axisMax = ticks[ticks.length - 1] || 1;
  const label = (day: string) =>
    new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );
  if (!report.days.length) return null;
  return (
    <Card style={{ padding: space.lg, gap: space.sm }}>
      <Text weight="semibold">{t("money.spendingDays")}</Text>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View
          testID="spending-days-axis"
          style={{
            width: 52,
            height: 120,
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          {[...ticks].reverse().map((tick) => (
            <Text key={tick} size="xs" tone="mutedForeground" tabular>
              {money(tick)}
            </Text>
          ))}
        </View>
        <View
          testID="spending-days"
          style={{
            flex: 1,
            height: 120,
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 2,
            borderBottomWidth: 1,
            borderColor: palette.border,
          }}
        >
          {report.days.map((day, index) => {
            const value = values[index] ?? 0;
            const tip = t("money.spendingDayTooltip", {
              date: label(day.date),
              amount: money(value),
            });
            return (
              <Pressable
                key={day.date}
                accessibilityRole="button"
                accessibilityLabel={tip}
                onPress={() => Alert.alert(tip)}
                style={{
                  flex: 1,
                  height: `${axisMax > 0 ? (value / axisMax) * 100 : 0}%`,
                  borderTopLeftRadius: 2,
                  borderTopRightRadius: 2,
                  backgroundColor: day.date > today ? palette.muted : COLORS.bar[mode],
                  opacity: day.date === today ? 0.7 : 1,
                }}
              />
            );
          })}
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingLeft: 60 }}>
        <Text size="xs" tone="mutedForeground">
          {label(report.days[0]!.date)}
        </Text>
        <Text size="xs" tone="mutedForeground">
          {label(report.days.at(-1)!.date)}
        </Text>
      </View>
    </Card>
  );
}

/** Top merchants by spending; tap filters the report by that shop. */
function Merchants({
  report,
  showAll,
  onShowAll,
  onSelect,
}: {
  report: SpendingReport;
  showAll: boolean;
  onShowAll: (next: boolean) => void;
  onSelect: (merchant: SpendingMerchant) => void;
}) {
  const palette = usePalette();
  if (!report.merchants.length) return null;
  const visible = showAll ? report.merchants : report.merchants.slice(0, LIST_TOP_N);
  return (
    <Card style={{ padding: space.lg, gap: space.md }} testID="spending-merchants">
      <Text weight="semibold" numberOfLines={1}>
        {t("money.spendingMerchants")}
      </Text>
      <Text size="xs" tone="mutedForeground" numberOfLines={1}>
        {t("money.spendingVsPreviousShort")}
      </Text>
      {visible.map((merchant) => (
        <Pressable
          key={`${merchant.brand_id ?? ""}:${merchant.name}`}
          accessibilityRole="button"
          accessibilityLabel={merchant.name}
          onPress={() => onSelect(merchant)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {merchant.logo_url ? (
            <Image
              source={{ uri: merchant.logo_url }}
              alt=""
              style={{ width: 36, height: 36, borderRadius: radius.lg }}
            />
          ) : (
            <View
              style={{
                width: 36,
                height: 36,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.lg,
                backgroundColor: merchant.base_color ?? palette.muted,
              }}
            >
              <Text
                weight="semibold"
                style={merchant.base_color ? { color: "#ffffff" } : undefined}
              >
                {merchant.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text size="sm" weight="medium" numberOfLines={1}>
              {merchant.name}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              <Text size="xs" tone="mutedForeground" numberOfLines={1}>
                {t("money.spendingMerchantCount", { count: merchant.transaction_count })}
              </Text>
              <Change value={merchant.expense} base={merchant.previous_expense} mode="expense" />
            </View>
          </View>
          <Text size="sm" weight="semibold">
            {money(merchant.expense)}
          </Text>
        </Pressable>
      ))}
      {report.merchants.length > LIST_TOP_N ? (
        <Button
          label={showAll ? t("money.spendingShowTop") : t("money.spendingShowAll")}
          variant="ghost"
          compact
          onPress={() => onShowAll(!showAll)}
        />
      ) : null}
    </Card>
  );
}
