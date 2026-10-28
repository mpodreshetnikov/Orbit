import {
  amountOf,
  changeTone,
  childCategories,
  formatChange,
  formatReportAmount,
  isoDay,
  lastYearOf,
  percentChange,
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
  type SpendingReport,
  type SpendingReportMode,
} from "@orbit-types/money-spending-report";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack } from "expo-router";
import { ChevronDown, ChevronLeft, ChevronRight, Filter, X } from "lucide-react-native";
import { useState } from "react";
import {
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

const categoryName = (category: Pick<SpendingCategory, "name_ru" | "name_en">) =>
  category.name_ru || category.name_en;

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
  const person = usePerson();
  const personId = person.data?.id;
  const accounts = useMoneyAccounts(personId);
  const [period, setPeriod] = useState<SpendingPeriod>(() =>
    periodContaining("month", isoDay(new Date())),
  );
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [mode, setMode] = useState<SpendingReportMode>("expense");
  const [mapParentId, setMapParentId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const report = useSpendingReport({
    personId,
    period,
    currency: CURRENCY,
    accountIds,
    categoryId,
  });
  const data = report.data;

  const filterBy = (id: string | null) => {
    setCategoryId(id);
    setMapParentId(null);
    setOpen(new Set());
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
  const listed = data ? topCategories(all, categoryId, mode) : [];
  const mapParent = all.find((one) => one.id === mapParentId) ?? null;
  const mapped = mapParent ? childCategories(all, mapParent.id, mode) : listed;

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
        {filter ? (
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
              {t("money.spendingFilterChip", { name: categoryName(filter) })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("money.spendingClearFilter")}
              hitSlop={space.sm}
              onPress={() => filterBy(null)}
              style={{ padding: 4, borderRadius: 999, backgroundColor: palette.mutedForeground }}
            >
              <Icon icon={X} size={12} tone="background" />
            </Pressable>
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
            <Forecast report={data} />

            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Text weight="semibold" style={{ flex: 1 }}>
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
                    }}
                  />
                </View>
              </View>
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
              <Card style={{ paddingVertical: space.xs }}>
                {listed.map((category, index) => (
                  <CategoryRow
                    key={category.id}
                    report={data}
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
            ) : null}

            <Days report={data} mode={mode} />
            <Merchants report={data} />
          </>
        )}
      </ScrollView>
    </>
  );
}

/** "▲ 8% к пред.": a change, coloured by whether it is good news, or a dash without a base. */
function Change({
  value,
  base,
  mode,
  label,
}: {
  value: number;
  base: number;
  mode: SpendingReportMode | "net";
  label: string;
}) {
  const scheme = useColorScheme();
  const change = percentChange(value, base);
  const tone = changeTone(change, mode);
  return (
    <Text
      size="xs"
      tone="mutedForeground"
      style={tone === "neutral" ? undefined : { color: toneColor(tone, scheme) }}
    >
      {`${formatChange(change) ?? "—"} ${label}`}
    </Text>
  );
}

/** Spending, income and net side by side, each against the period before and last year. */
function Totals({ report }: { report: SpendingReport }) {
  const scheme = useColorScheme();
  const { totals } = report;
  const year = String(report.period.last_year);
  const cards = [
    [
      "expense",
      "money.spendingExpense",
      totals.expense,
      totals.previous_expense,
      totals.last_year_expense,
    ],
    [
      "income",
      "money.spendingIncome",
      totals.income,
      totals.previous_income,
      totals.last_year_income,
    ],
    ["net", "money.spendingNet", totals.net, totals.previous_net, totals.last_year_net],
  ] as const;
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {cards.map(([key, title, value, previous, lastYear]) => (
        <Card key={key} style={{ flex: 1, padding: space.md, gap: 2 }}>
          <Text size="xs" tone="mutedForeground">
            {t(title)}
          </Text>
          <Text
            weight="bold"
            numberOfLines={1}
            adjustsFontSizeToFit
            testID={`spending-total-${key}`}
            style={key === "net" && value > 0 ? { color: toneColor("good", scheme) } : undefined}
          >
            {`${key === "net" && value > 0 ? "+" : ""}${money(value)}`}
          </Text>
          <Change
            value={value}
            base={previous}
            mode={key}
            label={t("money.spendingVsPreviousShort")}
          />
          <Change
            value={value}
            base={lastYear}
            mode={key}
            label={t("money.spendingVsLastYear", { year })}
          />
        </Card>
      ))}
    </View>
  );
}

/** Where spending is heading by the period's end, while the period runs. */
function Forecast({ report }: { report: SpendingReport }) {
  const palette = usePalette();
  const { forecast, totals, period } = report;
  if (!forecast) return null;
  const end = new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${period.end}T00:00:00Z`));
  const done = forecast.expense > 0 ? Math.min(100, (totals.expense / forecast.expense) * 100) : 0;
  return (
    <Card style={{ padding: space.lg, gap: space.xs }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Text size="sm" tone="mutedForeground" style={{ flex: 1 }}>
          {t("money.spendingForecast", { date: end })}
        </Text>
        <Text size="sm" weight="semibold" testID="spending-forecast">
          {`≈ ${money(forecast.expense)}`}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: radius.sm, backgroundColor: palette.muted }}>
        <View
          style={{
            width: `${done}%`,
            height: 8,
            borderRadius: radius.sm,
            backgroundColor: COLORS.bar.expense,
          }}
        />
      </View>
      <Text size="xs" tone="mutedForeground">
        {`${t("money.spendingForecastDaysLeft", { days: forecast.days_left })} · ${t("money.spendingForecastHint")}`}
      </Text>
    </Card>
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

/**
 * A category in the list: its amount and share, its changes under the name. A tap opens its
 * subcategories and the button that narrows the whole report to it.
 */
function CategoryRow({
  report,
  category,
  subcategories,
  total,
  mode,
  first,
  open,
  onToggle,
  onFilter,
}: {
  report: SpendingReport;
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
  const year = String(report.period.last_year);
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
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.sm }}>
            <Change
              value={amount}
              base={previousOf(category, mode)}
              mode={mode}
              label={t("money.spendingVsPreviousShort")}
            />
            <Change
              value={amount}
              base={lastYearOf(category, mode)}
              mode={mode}
              label={t("money.spendingVsLastYear", { year })}
            />
          </View>
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

/** One bar a day; the days still ahead are drawn empty. */
function Days({ report, mode }: { report: SpendingReport; mode: SpendingReportMode }) {
  const palette = usePalette();
  const today = isoDay(new Date());
  const values = report.days.map((day) => (mode === "income" ? day.income : day.expense));
  const max = Math.max(...values, 0);
  const label = (day: string) =>
    new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );
  if (!report.days.length) return null;
  return (
    <Card style={{ padding: space.lg, gap: space.sm }}>
      <Text weight="semibold">{t("money.spendingDays")}</Text>
      <View
        testID="spending-days"
        style={{
          height: 120,
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 2,
          borderBottomWidth: 1,
          borderColor: palette.border,
        }}
      >
        {report.days.map((day, index) => (
          <View
            key={day.date}
            style={{
              flex: 1,
              height: `${max > 0 ? ((values[index] ?? 0) / max) * 100 : 0}%`,
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              backgroundColor: day.date > today ? palette.muted : COLORS.bar[mode],
              opacity: day.date === today ? 0.7 : 1,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
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

/** The top merchants by spending, each with its logo or its colour and initial. */
function Merchants({ report }: { report: SpendingReport }) {
  const palette = usePalette();
  if (!report.merchants.length) return null;
  return (
    <Card style={{ padding: space.lg, gap: space.md }}>
      <Text weight="semibold">{t("money.spendingMerchants")}</Text>
      {report.merchants.slice(0, 6).map((merchant) => (
        <View
          key={`${merchant.brand_id ?? ""}:${merchant.name}`}
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
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
            <Text size="xs" tone="mutedForeground">
              {t("money.spendingMerchantCount", { count: merchant.transaction_count })}
            </Text>
          </View>
          <Text size="sm" weight="semibold">
            {money(merchant.expense)}
          </Text>
        </View>
      ))}
    </Card>
  );
}
