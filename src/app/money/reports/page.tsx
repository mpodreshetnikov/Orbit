"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { useIsMobile, useMoneyAccounts, useMoneySpendingReport } from "@/hooks";
import { useIntlLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import {
  amountOf,
  changeTone,
  childCategories,
  formatChange,
  formatReportAmount,
  isoDay,
  lastYearOf,
  parsePeriod,
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
} from "@/types/money-spending-report";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * "Отчёт" (T-261028-yhm): the period's spending, income and net with a forecast on top, then a
 * treemap and a table of categories against the previous period and last year's average, the
 * days and the top merchants. Period, accounts and a category filter live in the URL so a report
 * can be linked and reloaded as it was.
 */

const REPORT_CURRENCY = "RUB";
const PERIOD_KINDS: SpendingPeriodKind[] = ["week", "month", "last30", "custom"];

const TONE_CLASS = {
  good: "text-teal-800 dark:text-teal-300",
  bad: "text-orange-800 dark:text-orange-300",
  neutral: "text-muted-foreground",
} as const;

const SHADE_CLASS: Record<SpendingReportMode, Record<"strong" | "medium" | "light", string>> = {
  expense: {
    strong: "bg-orange-800 text-white",
    medium: "bg-orange-600 text-white",
    light: "bg-orange-200 text-orange-950",
  },
  income: {
    strong: "bg-teal-800 text-white",
    medium: "bg-teal-600 text-white",
    light: "bg-teal-200 text-teal-950",
  },
};

const BAR_CLASS: Record<SpendingReportMode, string> = {
  expense: "bg-orange-600",
  income: "bg-teal-600",
};

type Translate = ReturnType<typeof useTranslations>;

function categoryName(category: Pick<SpendingCategory, "name_ru" | "name_en">, locale: string) {
  return (locale.startsWith("ru") ? category.name_ru : category.name_en) || category.name_en;
}

function Change({
  value,
  base,
  mode,
  label,
}: {
  value: number;
  base: number;
  mode: SpendingReportMode | "net";
  label?: string;
}) {
  const change = percentChange(value, base);
  const text = formatChange(change);
  return (
    <span className={TONE_CLASS[changeTone(change, mode)]}>
      {text ?? "—"}
      {label ? ` ${label}` : null}
    </span>
  );
}

function PeriodControls({
  period,
  onChange,
  t,
  locale,
}: {
  period: SpendingPeriod;
  onChange: (period: SpendingPeriod) => void;
  t: Translate;
  locale: string;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(period.start);
  const [to, setTo] = useState(period.end);
  const labels: Record<SpendingPeriodKind, string> = {
    week: t("money.spendingPeriodWeek"),
    month: t("money.spendingPeriodMonth"),
    last30: t("money.spendingPeriodLast30"),
    custom: t("money.spendingPeriodCustom"),
  };

  return (
    <>
      <div role="group" className="flex rounded-lg bg-muted p-1">
        {PERIOD_KINDS.map((kind) =>
          kind === "custom" ? (
            <Popover key={kind} open={customOpen} onOpenChange={setCustomOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-pressed={period.kind === kind}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm",
                    period.kind === kind
                      ? "bg-background font-semibold shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {labels[kind]}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 space-y-3">
                <label className="block space-y-1 text-sm">
                  <span>{t("money.spendingCustomFrom")}</span>
                  <Input
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{t("money.spendingCustomTo")}</span>
                  <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!from || !to || from > to}
                  onClick={() => {
                    onChange({ kind: "custom", start: from, end: to });
                    setCustomOpen(false);
                  }}
                >
                  {t("money.spendingApply")}
                </Button>
              </PopoverContent>
            </Popover>
          ) : (
            <button
              key={kind}
              type="button"
              aria-pressed={period.kind === kind}
              onClick={() => onChange(periodContaining(kind, isoDay(new Date())))}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                period.kind === kind
                  ? "bg-background font-semibold shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {labels[kind]}
            </button>
          ),
        )}
      </div>
      <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("money.spendingPrevious")}
          onClick={() => onChange(shiftPeriod(period, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-36 text-center text-sm font-semibold first-letter:uppercase">
          {periodLabel(period, locale)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("money.spendingNext")}
          onClick={() => onChange(shiftPeriod(period, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}

function AccountFilter({
  personId,
  selected,
  onChange,
  t,
}: {
  personId: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
  t: Translate;
}) {
  const accounts = useMoneyAccounts(personId);
  const label =
    selected.length === 0
      ? t("money.spendingAllAccounts")
      : t("money.spendingAccountsCount", { count: selected.length });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="gap-1">
          {label}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        {(accounts.data ?? []).map((account) => {
          const checked = selected.includes(account.id);
          return (
            <label key={account.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(value) =>
                  onChange(
                    value
                      ? [...selected, account.id]
                      : selected.filter((accountId) => accountId !== account.id),
                  )
                }
              />
              {account.account_label}
            </label>
          );
        })}
        {selected.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            {t("money.spendingAllAccounts")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function Forecast({ report, t, locale }: { report: SpendingReport; t: Translate; locale: string }) {
  const { totals, forecast, period, currency } = report;
  if (!forecast) return null;
  const endLabel = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${period.end}T00:00:00Z`));
  const done = forecast.expense > 0 ? Math.min(100, (totals.expense / forecast.expense) * 100) : 0;
  return (
    <div data-testid="spending-forecast" className="space-y-1.5">
      <p className="flex justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {t("money.spendingForecast", { date: endLabel })}
        </span>
        <span className="font-semibold">
          ≈ {formatReportAmount(forecast.expense, currency, locale)}
        </span>
      </p>
      <div className="relative h-2 overflow-hidden rounded bg-muted">
        <div className="absolute inset-y-0 left-0 bg-orange-600" style={{ width: `${done}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("money.spendingForecastDaysLeft", { days: forecast.days_left })} ·{" "}
        {t("money.spendingForecastHint")}
      </p>
    </div>
  );
}

function TotalCards({
  report,
  t,
  locale,
  isMobile,
}: {
  report: SpendingReport;
  t: Translate;
  locale: string;
  isMobile: boolean;
}) {
  const { totals, period, currency } = report;
  const money = (amount: number) => formatReportAmount(amount, currency, locale);
  const year = String(period.last_year);
  const cards = [
    {
      key: "expense" as const,
      title: t("money.spendingExpense"),
      value: money(totals.expense),
      current: totals.expense,
      previous: totals.previous_expense,
      lastYear: totals.last_year_expense,
    },
    {
      key: "income" as const,
      title: t("money.spendingIncome"),
      value: money(totals.income),
      current: totals.income,
      previous: totals.previous_income,
      lastYear: totals.last_year_income,
    },
    {
      key: "net" as const,
      title: t("money.spendingNet"),
      value: `${totals.net > 0 ? "+" : ""}${money(totals.net)}`,
      current: totals.net,
      previous: totals.previous_net,
      lastYear: totals.last_year_net,
    },
  ];
  const netClass = (card: (typeof cards)[number]) =>
    card.key === "net" && card.current > 0 && "text-teal-800 dark:text-teal-300";

  if (isMobile) {
    // Three narrow tiles side by side, the forecast under them: the phone sees all three numbers
    // without scrolling, which three stacked cards would not allow.
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {cards.map((card) => (
            <Card key={card.key} data-testid={`spending-total-${card.key}`}>
              <CardContent className="space-y-1 p-3">
                <p className="text-xs text-muted-foreground">{card.title}</p>
                <p className={cn("text-base font-bold leading-tight", netClass(card))}>
                  {card.value}
                </p>
                <p className="text-xs">
                  <Change
                    value={card.current}
                    base={card.previous}
                    mode={card.key}
                    label={t("money.spendingVsPreviousShort")}
                  />
                </p>
                <p className="text-xs">
                  <Change
                    value={card.current}
                    base={card.lastYear}
                    mode={card.key}
                    label={t("money.spendingVsLastYear", { year })}
                  />
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        {report.forecast ? (
          <Card>
            <CardContent className="p-4">
              <Forecast report={report} t={t} locale={locale} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.key} data-testid={`spending-total-${card.key}`}>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm text-muted-foreground">{card.title}</p>
            <p className={cn("text-3xl font-bold tracking-tight", netClass(card))}>{card.value}</p>
            <p className="flex flex-wrap gap-x-3 text-sm">
              <Change
                value={card.current}
                base={card.previous}
                mode={card.key}
                label={t("money.spendingVsPrevious")}
              />
              <Change
                value={card.current}
                base={card.lastYear}
                mode={card.key}
                label={t("money.spendingVsLastYear", { year })}
              />
            </p>
            {card.key === "expense" && report.forecast ? (
              <div className="border-t pt-2">
                <Forecast report={report} t={t} locale={locale} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CategoryMap({
  report,
  categories,
  mode,
  onOpen,
  locale,
  isMobile,
}: {
  report: SpendingReport;
  categories: SpendingCategory[];
  mode: SpendingReportMode;
  onOpen: (category: SpendingCategory) => void;
  locale: string;
  isMobile: boolean;
}) {
  const total = categories.reduce((sum, category) => sum + amountOf(category, mode), 0);
  const tiles = squarify(categories, (category) => amountOf(category, mode), isMobile ? 1 : 3);
  return (
    <div
      data-testid="spending-treemap"
      className={cn("relative w-full", isMobile ? "aspect-square" : "aspect-[3/1]")}
    >
      {tiles.map((tile, rank) => {
        const category = tile.item;
        const amount = amountOf(category, mode);
        const share = total > 0 ? Math.round((amount / total) * 100) : 0;
        // On a square phone map a tile needs a fifth of the width to fit a name and an amount.
        const roomy = isMobile
          ? tile.width > 0.22 && tile.height > 0.16
          : tile.width > 0.08 && tile.height > 0.22;
        // Too narrow for a word: the tile keeps its colour and its title, not a broken label.
        const tiny = isMobile
          ? tile.width < 0.14 || tile.height < 0.08
          : tile.width < 0.04 || tile.height < 0.12;
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onOpen(category)}
            title={`${categoryName(category, locale)} · ${formatReportAmount(amount, report.currency, locale)}`}
            className={cn(
              "absolute flex flex-col justify-start overflow-hidden rounded-lg border-2 border-background p-2 text-left",
              SHADE_CLASS[mode][treemapShade(rank, tiles.length)],
              category.system_key === "uncategorized" &&
                "outline-dashed outline-2 -outline-offset-4",
            )}
            style={{
              left: `${tile.x * 100}%`,
              top: `${tile.y * 100}%`,
              width: `${tile.width * 100}%`,
              height: `${tile.height * 100}%`,
            }}
          >
            {tiny ? null : (
              <span
                className={cn(
                  "block break-words font-semibold leading-tight",
                  roomy && !isMobile ? "text-base" : "text-xs",
                )}
              >
                {categoryName(category, locale)}
              </span>
            )}
            {roomy ? (
              <span className={cn("block", isMobile ? "text-xs" : "text-sm")}>
                {formatReportAmount(amount, report.currency, locale)} · {share}%
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Sparkline({ category, mode }: { category: SpendingCategory; mode: SpendingReportMode }) {
  const values = category.months.map((month) => (mode === "income" ? month.income : month.expense));
  const max = Math.max(...values, 0);
  return (
    <span aria-hidden="true" className="flex h-6 items-end gap-0.5">
      {values.map((value, index) => (
        <span
          key={category.months[index]?.month_start ?? index}
          className={cn(
            "w-1.5 rounded-sm",
            index === values.length - 1 ? BAR_CLASS[mode] : "bg-muted-foreground/30",
          )}
          style={{ height: `${max > 0 ? Math.max(2, (value / max) * 24) : 2}px` }}
        />
      ))}
    </span>
  );
}

/**
 * The phone's category list: a table would scroll sideways, so each row carries its comparisons
 * under the name, and a tap opens the subcategories with the button that filters the report.
 */
function CategoryList({
  report,
  categories,
  allCategories,
  mode,
  expanded,
  onToggle,
  onFilter,
  t,
  locale,
}: {
  report: SpendingReport;
  categories: SpendingCategory[];
  allCategories: SpendingCategory[];
  mode: SpendingReportMode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onFilter: (category: SpendingCategory) => void;
  t: Translate;
  locale: string;
}) {
  const total = categories.reduce((sum, category) => sum + amountOf(category, mode), 0);
  const year = String(report.period.last_year);
  return (
    <Card>
      <ul className="divide-y">
        {categories.map((category) => {
          const amount = amountOf(category, mode);
          const name = categoryName(category, locale);
          const open = expanded.has(category.id);
          const children = category.has_children
            ? childCategories(allCategories, category.id, mode)
            : [];
          return (
            <li key={category.id} data-testid={`spending-row-${category.id}`}>
              <button
                type="button"
                aria-expanded={open}
                aria-label={t(open ? "money.spendingCollapse" : "money.spendingExpand", { name })}
                onClick={() => onToggle(category.id)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-[15px] font-medium">
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">{name}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
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
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-[15px] font-semibold">
                    {formatReportAmount(amount, report.currency, locale)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {total > 0 ? `${Math.round((amount / total) * 100)}%` : ""}
                  </span>
                </span>
              </button>
              {open ? (
                <div className="space-y-2 px-4 pb-3 pl-9">
                  {children.map((child) => (
                    <p
                      key={child.id}
                      className="flex justify-between text-sm text-muted-foreground"
                    >
                      <span>{categoryName(child, locale)}</span>
                      <span>
                        {formatReportAmount(amountOf(child, mode), report.currency, locale)}
                      </span>
                    </p>
                  ))}
                  <Button type="button" className="min-h-11" onClick={() => onFilter(category)}>
                    <Filter className="mr-1.5 h-4 w-4" />
                    {t("money.spendingFilterByCategory", { name })}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CategoryTable({
  report,
  categories,
  allCategories,
  mode,
  expanded,
  onToggle,
  onFilter,
  t,
  locale,
}: {
  report: SpendingReport;
  categories: SpendingCategory[];
  allCategories: SpendingCategory[];
  mode: SpendingReportMode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onFilter: (category: SpendingCategory) => void;
  t: Translate;
  locale: string;
}) {
  const total = categories.reduce((sum, category) => sum + amountOf(category, mode), 0);
  const year = String(report.period.last_year);
  const columns =
    "grid grid-cols-[minmax(10rem,2fr)_7rem_4rem_5.5rem_6.5rem_7rem_2.5rem] items-center gap-3";

  function row(category: SpendingCategory, depth: number): React.ReactNode {
    const amount = amountOf(category, mode);
    const children = category.has_children ? childCategories(allCategories, category.id, mode) : [];
    const open = expanded.has(category.id);
    const name = categoryName(category, locale);
    return (
      <div key={category.id}>
        <div
          data-testid={`spending-row-${category.id}`}
          className={cn(
            columns,
            "border-b px-4 py-2 text-sm",
            depth > 0 && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
            {children.length > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={t(open ? "money.spendingCollapse" : "money.spendingExpand", { name })}
                onClick={() => onToggle(category.id)}
                className="text-muted-foreground"
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className="truncate">{name}</span>
          </span>
          <span className="text-right font-semibold text-foreground">
            {formatReportAmount(amount, report.currency, locale)}
          </span>
          <span className="text-right text-muted-foreground">
            {depth === 0 && total > 0 ? `${Math.round((amount / total) * 100)}%` : ""}
          </span>
          <span className="text-right">
            <Change value={amount} base={previousOf(category, mode)} mode={mode} />
          </span>
          <span className="text-right">
            <Change value={amount} base={lastYearOf(category, mode)} mode={mode} />
          </span>
          <Sparkline category={category} mode={mode} />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t("money.spendingFilterByCategory", { name })}
            title={t("money.spendingFilterByCategory", { name })}
            onClick={() => onFilter(category)}
          >
            <Filter className="h-3.5 w-3.5" />
          </Button>
        </div>
        {open ? children.map((child) => row(child, depth + 1)) : null}
      </div>
    );
  }

  return (
    <Card className="overflow-x-auto">
      <div className="min-w-[46rem]">
        <div className={cn(columns, "border-b px-4 py-3 text-xs text-muted-foreground")}>
          <span>{t("money.spendingColumnCategory")}</span>
          <span className="text-right">{t("money.spendingColumnAmount")}</span>
          <span className="text-right">{t("money.spendingColumnShare")}</span>
          <span className="text-right">{t("money.spendingColumnPrevious")}</span>
          <span className="text-right">{t("money.spendingColumnLastYear", { year })}</span>
          <span>{t("money.spendingColumnMonths")}</span>
          <span />
        </div>
        {categories.map((category) => row(category, 0))}
      </div>
    </Card>
  );
}

function DaysChart({
  report,
  mode,
  t,
  locale,
}: {
  report: SpendingReport;
  mode: SpendingReportMode;
  t: Translate;
  locale: string;
}) {
  const today = isoDay(new Date());
  const values = report.days.map((day) => (mode === "income" ? day.income : day.expense));
  const max = Math.max(...values, 0);
  const dayLabel = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return (
    <Card className="min-w-0 flex-[999_1_34rem]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("money.spendingDays")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div data-testid="spending-days" className="flex h-36 items-end gap-0.5 border-b">
          {report.days.map((day, index) => {
            const value = values[index] ?? 0;
            const label = t("money.spendingDayTooltip", {
              date: dayLabel.format(new Date(`${day.date}T00:00:00Z`)),
              amount: formatReportAmount(value, report.currency, locale),
            });
            return (
              <span
                key={day.date}
                title={label}
                className={cn(
                  "flex-1 rounded-t-sm",
                  day.date > today ? "bg-muted" : BAR_CLASS[mode],
                  day.date === today && "opacity-70",
                )}
                style={{ height: `${max > 0 ? (value / max) * 100 : 0}%` }}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {report.days[0] ? dayLabel.format(new Date(`${report.days[0].date}T00:00:00Z`)) : ""}
          </span>
          <span>
            {report.days.at(-1)
              ? dayLabel.format(new Date(`${report.days.at(-1)!.date}T00:00:00Z`))
              : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MerchantList({
  report,
  t,
  locale,
}: {
  report: SpendingReport;
  t: Translate;
  locale: string;
}) {
  if (report.merchants.length === 0) return null;
  return (
    <Card className="min-w-0 flex-[1_1_20rem]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("money.spendingMerchants")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul data-testid="spending-merchants" className="space-y-3">
          {report.merchants.slice(0, 6).map((merchant) => (
            <li
              key={`${merchant.brand_id ?? ""}:${merchant.name}`}
              className="flex items-center gap-3"
            >
              {merchant.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- brand logos come from many hosts
                <img src={merchant.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted font-semibold"
                  style={
                    merchant.base_color
                      ? { background: merchant.base_color, color: "#fff" }
                      : undefined
                  }
                >
                  {merchant.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{merchant.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("money.spendingMerchantCount", { count: merchant.transaction_count })}
                </span>
              </span>
              <span className="text-sm font-semibold">
                {formatReportAmount(merchant.expense, report.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function MoneyReportsPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useIntlLocale();
  const isMobile = useIsMobile();
  const personId = useUIStore((state) => state.selectedPersonId);
  const paramsString = searchParams?.toString() ?? "";
  const today = isoDay(new Date());

  const period = parsePeriod(
    searchParams?.get("period") ?? null,
    searchParams?.get("start") ?? null,
    searchParams?.get("end") ?? null,
    today,
  );
  const accountIds = useMemo(
    () => (searchParams?.get("accounts") ?? "").split(",").filter(Boolean),
    [searchParams],
  );
  const categoryId = searchParams?.get("category") || null;
  const [mode, setMode] = useState<SpendingReportMode>("expense");
  const [mapParentId, setMapParentId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const reportQuery = useMoneySpendingReport({
    personId,
    period,
    currency: REPORT_CURRENCY,
    accountIds,
    categoryId,
  });
  const report = reportQuery.data;

  function updateParams(update: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(paramsString);
    update(next);
    router.replace(`/money/reports?${next.toString()}`, { scroll: false });
  }

  function setPeriod(next: SpendingPeriod) {
    updateParams((params) => {
      params.set("period", next.kind);
      params.set("start", next.start);
      if (next.kind === "custom") params.set("end", next.end);
      else params.delete("end");
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setCategoryFilter(id: string | null) {
    setMapParentId(null);
    setExpanded(new Set());
    updateParams((params) => {
      if (id) params.set("category", id);
      else params.delete("category");
    });
  }

  const allCategories = report?.categories ?? [];
  const filterCategory = allCategories.find((category) => category.id === categoryId) ?? null;
  const tableCategories = report ? topCategories(allCategories, categoryId, mode) : [];
  const mapParent = allCategories.find((category) => category.id === mapParentId) ?? null;
  const mapCategories = mapParent
    ? childCategories(allCategories, mapParent.id, mode)
    : tableCategories;

  if (!personId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("money.spendingTitle")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodControls
            key={`${period.start}:${period.end}`}
            period={period}
            onChange={setPeriod}
            t={t}
            locale={locale}
          />
          <AccountFilter
            personId={personId}
            selected={accountIds}
            onChange={(ids) =>
              updateParams((params) => {
                if (ids.length > 0) params.set("accounts", ids.join(","));
                else params.delete("accounts");
              })
            }
            t={t}
          />
          <span className="text-sm text-muted-foreground">
            {t("money.spendingCurrencyNote", { currency: REPORT_CURRENCY })}
          </span>
        </div>
      </div>

      {filterCategory ? (
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-foreground py-1 pl-3 pr-1 text-sm text-background">
            {t("money.spendingFilterChip", { name: categoryName(filterCategory, locale) })}
            <button
              type="button"
              aria-label={t("money.spendingClearFilter")}
              onClick={() => setCategoryFilter(null)}
              className="rounded-full bg-background/20 p-1"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      ) : null}

      {reportQuery.isError ? (
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {t("money.spendingLoadFailed")}
          </CardContent>
        </Card>
      ) : !report ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-40 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : (
        <>
          {report.fx_status.status !== "ok" ? (
            <p
              role="status"
              className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-950 dark:bg-orange-950 dark:text-orange-100"
            >
              {report.fx_status.status === "error"
                ? t("money.spendingFxMissing", { pairs: report.fx_status.missing.join(", ") })
                : t("money.spendingFxApproximate")}
            </p>
          ) : null}

          <TotalCards report={report} t={t} locale={locale} isMobile={isMobile} />

          <Card>
            <CardHeader className="space-y-3 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <CardTitle className="text-base">{t("money.spendingCategories")}</CardTitle>
                  {mapParent ? (
                    <span className="text-sm">
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          setMapParentId(
                            mapParent.parent_id && mapParent.parent_id !== categoryId
                              ? mapParent.parent_id
                              : null,
                          )
                        }
                      >
                        {filterCategory
                          ? categoryName(filterCategory, locale)
                          : t("money.spendingAllCategories")}
                      </button>
                      {" › "}
                      {categoryName(mapParent, locale)}
                    </span>
                  ) : null}
                </div>
                <div role="group" className="flex rounded-lg bg-muted p-1">
                  {(["expense", "income"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mode === value}
                      onClick={() => {
                        setMode(value);
                        setMapParentId(null);
                      }}
                      className={cn(
                        "rounded-md px-3 py-1 text-sm",
                        mode === value
                          ? "bg-background font-semibold shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      {value === "expense" ? t("money.spendingExpense") : t("money.spendingIncome")}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{t("money.spendingCategoriesHint")}</p>
            </CardHeader>
            <CardContent>
              {mapCategories.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("money.spendingEmpty")}
                </p>
              ) : (
                <CategoryMap
                  report={report}
                  categories={mapCategories}
                  mode={mode}
                  locale={locale}
                  isMobile={isMobile}
                  onOpen={(category) => {
                    if (
                      category.has_children &&
                      childCategories(allCategories, category.id, mode).length > 0
                    ) {
                      setMapParentId(category.id);
                    } else {
                      setCategoryFilter(category.id);
                    }
                  }}
                />
              )}
            </CardContent>
          </Card>

          {tableCategories.length > 0 && isMobile ? (
            <CategoryList
              report={report}
              categories={tableCategories}
              allCategories={allCategories}
              mode={mode}
              expanded={expanded}
              onToggle={toggleExpanded}
              onFilter={(category) => setCategoryFilter(category.id)}
              t={t}
              locale={locale}
            />
          ) : tableCategories.length > 0 ? (
            <CategoryTable
              report={report}
              categories={tableCategories}
              allCategories={allCategories}
              mode={mode}
              expanded={expanded}
              onToggle={toggleExpanded}
              onFilter={(category) => setCategoryFilter(category.id)}
              t={t}
              locale={locale}
            />
          ) : null}

          <div className="flex flex-wrap items-start gap-4">
            <DaysChart report={report} mode={mode} t={t} locale={locale} />
            <MerchantList report={report} t={t} locale={locale} />
          </div>
        </>
      )}
    </div>
  );
}
