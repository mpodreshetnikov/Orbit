"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { useIsMobile, useMoneyAccounts } from "@/hooks";
import { useMoneySpendingReport } from "@/hooks/use-money-spending-report";
import { useIntlLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import { niceAxisTicks } from "@/types/money-report-axis-ticks";
import { formatChange, percentChange } from "@/types/money-report-change";
import { transactionsFeedQuery } from "@/types/money-report-feed-query";
import {
  amountOf,
  changeTone,
  childCategories,
  formatReportAmount,
  isoDay,
  lastYearOf,
  parsePeriod,
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
} from "@/types/money-spending-report";
import type { SpendingMerchant, SpendingReport } from "@/types/money-spending-report-ux";
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

function categoryName(
  category: Pick<SpendingCategory, "name_ru" | "name_en" | "direct">,
  locale: string,
  t?: Translate,
) {
  const name = (locale.startsWith("ru") ? category.name_ru : category.name_en) || category.name_en;
  return category.direct && t ? t("money.spendingDirect", { name }) : name;
}

/**
 * Compact self-evident change badge (`▲ 17% к окт.`). Hides the old «новое» chip — no basis
 * means no badge. Comparison math stays in {@link percentChange} / {@link formatChange}.
 */
function Change({
  value,
  base,
  mode,
  basisLabel,
  newLabel,
  title,
}: {
  value: number;
  base: number;
  mode: SpendingReportMode | "net";
  /** Short basis inside the badge, e.g. `к окт.` / `vs Oct`. */
  basisLabel?: string;
  newLabel?: string;
  title?: string;
}) {
  const change = percentChange(value, base);
  const text = formatChange(change, { value, base, newLabel });
  // «новое» without a %, or nothing to show — omit the chip (Lead: clear or hide).
  if (text === null || (newLabel !== undefined && text === newLabel)) return null;
  const tone = changeTone(change, mode);
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none",
        tone === "good" && "bg-teal-500/10",
        tone === "bad" && "bg-orange-500/10",
        tone === "neutral" && "bg-muted",
        TONE_CLASS[tone],
      )}
    >
      {basisLabel ? `${text} ${basisLabel}` : text}
    </span>
  );
}

/** Short month of the previous comparison window (`окт.` / `Oct`) for badge copy. */
function previousBasisShort(previousStart: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(previousStart)) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${previousStart}T00:00:00Z`));
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
  const chipKinds = PERIOD_KINDS.filter((kind) => kind !== "custom");
  const customPopover = (
    <Popover open={customOpen} onOpenChange={setCustomOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={period.kind === "custom"}
          className={cn(
            "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm",
            period.kind === "custom"
              ? "bg-background font-semibold shadow-sm"
              : "text-muted-foreground",
          )}
        >
          {labels.custom}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3">
        <label className="block space-y-1 text-sm">
          <span>{t("money.spendingCustomFrom")}</span>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
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
  );

  const monthAndCustom = (
    <div className="flex w-full min-w-0 flex-nowrap items-center gap-1 overflow-x-auto rounded-lg border bg-background p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label={t("money.spendingPrevious")}
        onClick={() => onChange(shiftPeriod(period, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-0 flex-1 whitespace-nowrap text-center text-sm font-semibold first-letter:uppercase">
        {periodLabel(period, locale)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label={t("money.spendingNext")}
        onClick={() => onChange(shiftPeriod(period, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <div
        className={cn(
          "ml-0.5 flex shrink-0 rounded-md",
          period.kind === "custom" ? "bg-muted" : undefined,
        )}
      >
        {customPopover}
      </div>
    </div>
  );

  // Phone: chips on one row; ‹ month › + «Период…» on their own nowrap row (Lead).
  // Desktop: chips and month+custom share one strip like before.
  return (
    <div
      className={cn(
        "flex min-w-0 gap-2",
        // Detect phone via viewport class from parent flex-col — PeriodControls itself stays
        // responsive with max-md stacking so ‹ month › + Период… never fight the chips for width.
        "max-md:flex-col md:flex-nowrap md:items-center md:overflow-x-auto md:[-ms-overflow-style:none] md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden",
      )}
    >
      <div
        role="group"
        className="flex w-full shrink-0 overflow-x-auto rounded-lg bg-muted p-1 md:w-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {chipKinds.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={period.kind === kind}
            onClick={() => onChange(periodContaining(kind, isoDay(new Date())))}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm",
              period.kind === kind
                ? "bg-background font-semibold shadow-sm"
                : "text-muted-foreground",
            )}
          >
            {labels[kind]}
          </button>
        ))}
      </div>
      {monthAndCustom}
    </div>
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
        <Button type="button" variant="outline" className="shrink-0 gap-1 whitespace-nowrap">
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

/** Short end-of-period date for the calm forecast line under a total. */
function forecastDateLabel(periodEnd: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${periodEnd}T00:00:00Z`));
}

/**
 * Quiet forecast line inside a total card (`Прогноз на 30 нояб.: ≈X`). Title carries days-left +
 * pace hint; forecast amounts are unchanged.
 */
function ForecastLine({
  date,
  amount,
  hint,
  testId,
  t,
  compact,
}: {
  date: string;
  amount: string;
  hint: string;
  testId: string;
  t: Translate;
  /** Phone cards: allow a soft wrap between label and amount, never mid-token. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p
        data-testid={testId}
        title={hint}
        className="text-[10px] leading-tight text-muted-foreground"
      >
        <span className="whitespace-nowrap">{t("money.spendingForecastLineLabel", { date })}</span>{" "}
        <span className="whitespace-nowrap tabular-nums">≈{amount}</span>
      </p>
    );
  }
  return (
    <p
      data-testid={testId}
      title={hint}
      className="truncate whitespace-nowrap text-[11px] leading-tight text-muted-foreground"
    >
      {t("money.spendingForecastLine", { date, amount })}
    </p>
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
  const { totals, period, currency, forecast } = report;
  const money = (amount: number) => formatReportAmount(amount, currency, locale);
  const narrowMoney = (amount: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return money(amount);
    }
  };
  const formatAmount = isMobile ? narrowMoney : money;
  const year = String(period.last_year);
  const prevBasis = previousBasisShort(period.previous_start, locale);
  const prevBadge = prevBasis ? t("money.spendingBadgePrevious", { period: prevBasis }) : undefined;
  const yearBadge = t("money.spendingBadgeLastYear", { year });
  const newLabel = t("money.spendingChangeNew");
  const endLabel = forecastDateLabel(period.end, locale);
  const forecastHint = forecast
    ? `${t("money.spendingForecastDaysLeft", { days: forecast.days_left })} · ${t("money.spendingForecastHint")}`
    : "";
  const cards = [
    {
      key: "expense" as const,
      title: t("money.spendingExpense"),
      value: formatAmount(totals.expense),
      current: totals.expense,
      previous: totals.previous_expense,
      lastYear: totals.last_year_expense,
      forecastAmount: forecast ? formatAmount(forecast.expense) : null,
      forecastTestId: "spending-forecast",
    },
    {
      key: "income" as const,
      title: t("money.spendingIncome"),
      value: formatAmount(totals.income),
      current: totals.income,
      previous: totals.previous_income,
      lastYear: totals.last_year_income,
      forecastAmount: forecast ? formatAmount(forecast.income) : null,
      forecastTestId: "spending-forecast-income",
    },
    {
      key: "net" as const,
      title: t("money.spendingNet"),
      value: `${totals.net > 0 ? "+" : ""}${formatAmount(totals.net)}`,
      current: totals.net,
      previous: totals.previous_net,
      lastYear: totals.last_year_net,
      forecastAmount: forecast
        ? `${forecast.net > 0 ? "+" : ""}${formatAmount(forecast.net)}`
        : null,
      forecastTestId: "spending-forecast-net",
    },
  ];
  const netClass = (card: (typeof cards)[number]) =>
    card.key === "net" && card.current > 0 && "text-teal-800 dark:text-teal-300";

  return (
    <div className={cn(isMobile ? "space-y-2" : "space-y-3")}>
      <div className={cn(isMobile ? "grid grid-cols-3 gap-1.5" : "grid gap-4 md:grid-cols-3")}>
        {cards.map((card) => (
          <Card
            key={card.key}
            className={isMobile ? "min-w-0 overflow-hidden" : undefined}
            data-testid={`spending-total-${card.key}`}
          >
            <CardContent className={cn("space-y-1", isMobile ? "p-2" : "space-y-2 p-5")}>
              <p
                className={cn(
                  "truncate whitespace-nowrap text-muted-foreground",
                  isMobile ? "text-xs" : "text-sm",
                )}
              >
                {card.title}
              </p>
              <p
                className={cn(
                  "truncate whitespace-nowrap font-bold tabular-nums",
                  isMobile ? "text-sm leading-tight" : "text-3xl tracking-tight",
                  netClass(card),
                )}
              >
                {card.value}
              </p>
              {card.forecastAmount ? (
                <ForecastLine
                  date={endLabel}
                  amount={card.forecastAmount}
                  hint={forecastHint}
                  testId={card.forecastTestId}
                  t={t}
                  compact={isMobile}
                />
              ) : null}
              <div className={cn("flex flex-wrap", isMobile ? "gap-1" : "gap-1.5")}>
                <Change
                  value={card.current}
                  base={card.previous}
                  mode={card.key}
                  basisLabel={prevBadge}
                  title={t("money.spendingVsPrevious")}
                  newLabel={newLabel}
                />
                <Change
                  value={card.current}
                  base={card.lastYear}
                  mode={card.key}
                  basisLabel={yearBadge}
                  title={t("money.spendingVsLastYear", { year })}
                  newLabel={newLabel}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CategoryMap({
  report,
  categories,
  mode,
  onOpen,
  t,
  locale,
  isMobile,
}: {
  report: SpendingReport;
  categories: SpendingCategory[];
  mode: SpendingReportMode;
  onOpen: (category: SpendingCategory) => void;
  t: Translate;
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
            title={`${categoryName(category, locale, t)} · ${formatReportAmount(amount, report.currency, locale)}`}
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
                  // Keep whole words; overflow clips instead of letter-splitting (e.g. Uncategorize/d).
                  "block overflow-hidden break-keep font-semibold leading-tight",
                  isMobile && "whitespace-nowrap",
                  roomy && !isMobile ? "text-base" : "text-xs",
                )}
              >
                {categoryName(category, locale, t)}
              </span>
            )}
            {roomy ? (
              <span
                className={cn(
                  "block whitespace-nowrap tabular-nums",
                  isMobile ? "text-xs" : "text-sm",
                )}
              >
                {formatReportAmount(amount, report.currency, locale)} · {share}%
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Sparkline({
  category,
  mode,
  currency,
  locale,
  t,
}: {
  category: SpendingCategory;
  mode: SpendingReportMode;
  currency: string;
  locale: string;
  t: Translate;
}) {
  const values = category.months.map((month) => (mode === "income" ? month.income : month.expense));
  const max = Math.max(...values, 0);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <span className="flex h-6 items-end gap-0.5" data-testid="spending-sparkline">
      {values.map((value, index) => {
        const month = category.months[index]?.month_start;
        const title = t("money.spendingMonthTooltip", {
          month: month ? monthLabel.format(new Date(`${month}T00:00:00Z`)) : String(index + 1),
          amount: formatReportAmount(value, currency, locale),
        });
        return (
          <span
            key={month ?? index}
            title={title}
            aria-label={title}
            role="img"
            className={cn(
              "inline-block w-1.5 rounded-sm",
              index === values.length - 1 ? BAR_CLASS[mode] : "bg-muted-foreground/30",
            )}
            style={{ height: `${max > 0 ? Math.max(2, (value / max) * 24) : 2}px` }}
          />
        );
      })}
    </span>
  );
}

const LIST_TOP_N = 10;

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
  const prevShort = previousBasisShort(report.period.previous_start, locale);
  const prevBadge = prevShort ? t("money.spendingBadgePrevious", { period: prevShort }) : undefined;
  const yearBadge = t("money.spendingBadgeLastYear", { year });
  const newLabel = t("money.spendingChangeNew");
  return (
    <Card>
      <ul className="divide-y">
        {categories.map((category) => {
          const amount = amountOf(category, mode);
          const name = categoryName(category, locale, t);
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
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    <Change
                      value={amount}
                      base={previousOf(category, mode)}
                      mode={mode}
                      basisLabel={prevBadge}
                      title={t("money.spendingVsPreviousShort")}
                      newLabel={newLabel}
                    />
                    <Change
                      value={amount}
                      base={lastYearOf(category, mode)}
                      mode={mode}
                      basisLabel={yearBadge}
                      title={t("money.spendingVsLastYear", { year })}
                      newLabel={newLabel}
                    />
                  </span>
                  {category.months.length > 0 ? (
                    <span
                      className="mt-1 block"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Sparkline
                        category={category}
                        mode={mode}
                        currency={report.currency}
                        locale={locale}
                        t={t}
                      />
                    </span>
                  ) : null}
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
                      <span>{categoryName(child, locale, t)}</span>
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
  const prevShort = previousBasisShort(report.period.previous_start, locale);
  const prevBadge = prevShort ? t("money.spendingBadgePrevious", { period: prevShort }) : undefined;
  const yearBadge = t("money.spendingBadgeLastYear", { year });
  const newLabel = t("money.spendingChangeNew");
  const columns =
    "grid grid-cols-[minmax(10rem,2fr)_7rem_4rem_5.5rem_6.5rem_7rem_2.5rem] items-center gap-3";

  function row(category: SpendingCategory, depth: number): React.ReactNode {
    const amount = amountOf(category, mode);
    const children = category.has_children ? childCategories(allCategories, category.id, mode) : [];
    const open = expanded.has(category.id);
    const name = categoryName(category, locale, t);
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
            <Change
              value={amount}
              base={previousOf(category, mode)}
              mode={mode}
              basisLabel={prevBadge}
              newLabel={newLabel}
            />
          </span>
          <span className="text-right">
            <Change
              value={amount}
              base={lastYearOf(category, mode)}
              mode={mode}
              basisLabel={yearBadge}
              newLabel={newLabel}
            />
          </span>
          <Sparkline
            category={category}
            mode={mode}
            currency={report.currency}
            locale={locale}
            t={t}
          />
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
  const ticks = niceAxisTicks(max);
  const axisMax = ticks[ticks.length - 1] || 1;
  const dayLabel = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return (
    <Card className="min-w-0 w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("money.spendingDays")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <div
            data-testid="spending-days-axis"
            className="flex h-36 w-12 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-muted-foreground"
          >
            {[...ticks].reverse().map((tick) => (
              <span key={tick}>{formatReportAmount(tick, report.currency, locale)}</span>
            ))}
          </div>
          <div
            data-testid="spending-days"
            className="relative flex h-36 min-w-0 flex-1 items-end gap-0.5 border-b"
          >
            {ticks.slice(1).map((tick) => (
              <span
                key={`grid-${tick}`}
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 border-t border-muted"
                style={{ bottom: `${(tick / axisMax) * 100}%` }}
              />
            ))}
            {report.days.map((day, index) => {
              const value = values[index] ?? 0;
              const label = t("money.spendingDayTooltip", {
                date: dayLabel.format(new Date(`${day.date}T00:00:00Z`)),
                amount: formatReportAmount(value, report.currency, locale),
              });
              return (
                <button
                  key={day.date}
                  type="button"
                  title={label}
                  aria-label={label}
                  className={cn(
                    "relative z-[1] flex-1 rounded-t-sm",
                    day.date > today ? "bg-muted" : BAR_CLASS[mode],
                    day.date === today && "opacity-70",
                  )}
                  style={{ height: `${axisMax > 0 ? (value / axisMax) * 100 : 0}%` }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex justify-between pl-14 text-xs text-muted-foreground">
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
  showAll,
  onShowAll,
  onSelect,
}: {
  report: SpendingReport;
  t: Translate;
  locale: string;
  showAll: boolean;
  onShowAll: (next: boolean) => void;
  onSelect: (merchant: SpendingMerchant) => void;
}) {
  if (report.merchants.length === 0) return null;
  const visible = showAll ? report.merchants : report.merchants.slice(0, LIST_TOP_N);
  const prevShort = previousBasisShort(report.period.previous_start, locale);
  const prevBadge = prevShort ? t("money.spendingBadgePrevious", { period: prevShort }) : undefined;
  const newLabel = t("money.spendingChangeNew");
  return (
    <Card className="min-w-0 w-full">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-base">{t("money.spendingMerchants")}</CardTitle>
        <p className="whitespace-nowrap text-[11px] text-muted-foreground">
          {t("money.spendingVsPreviousShort")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul data-testid="spending-merchants" className="space-y-3">
          {visible.map((merchant) => (
            <li key={`${merchant.brand_id ?? ""}:${merchant.name}`}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg text-left hover:bg-muted/60"
                onClick={() => onSelect(merchant)}
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
                  <span className="block truncate whitespace-nowrap text-sm font-medium">
                    {merchant.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span className="whitespace-nowrap">
                      {t("money.spendingMerchantCount", { count: merchant.transaction_count })}
                    </span>
                    <Change
                      value={merchant.expense}
                      base={merchant.previous_expense}
                      mode="expense"
                      basisLabel={prevBadge}
                      title={t("money.spendingVsPreviousShort")}
                      newLabel={newLabel}
                    />
                  </span>
                </span>
                <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
                  {formatReportAmount(merchant.expense, report.currency, locale)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {report.merchants.length > LIST_TOP_N ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onShowAll(!showAll)}>
            {showAll ? t("money.spendingShowTop") : t("money.spendingShowAll")}
          </Button>
        ) : null}
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
  const merchantName = searchParams?.get("merchant") || null;
  const brandId = searchParams?.get("brand") || null;
  const [mode, setMode] = useState<SpendingReportMode>(
    searchParams?.get("mode") === "income" ? "income" : "expense",
  );
  const [mapParentId, setMapParentId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllMerchants, setShowAllMerchants] = useState(false);

  const reportQuery = useMoneySpendingReport({
    personId,
    period,
    currency: REPORT_CURRENCY,
    accountIds,
    categoryId,
    brandId,
    merchantName,
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
    setShowAllCategories(false);
    updateParams((params) => {
      if (id) params.set("category", id);
      else params.delete("category");
    });
  }

  function setMerchantFilter(merchant: SpendingMerchant | null) {
    setShowAllMerchants(false);
    updateParams((params) => {
      if (merchant) {
        params.set("merchant", merchant.name);
        if (merchant.brand_id) params.set("brand", merchant.brand_id);
        else params.delete("brand");
      } else {
        params.delete("merchant");
        params.delete("brand");
      }
    });
  }

  const allCategories = report?.categories ?? [];
  const filterCategory = allCategories.find((category) => category.id === categoryId) ?? null;
  const allTableCategories = report ? topCategories(allCategories, categoryId, mode) : [];
  const tableCategories = showAllCategories
    ? allTableCategories
    : allTableCategories.slice(0, LIST_TOP_N);
  const mapParent = allCategories.find((category) => category.id === mapParentId) ?? null;
  const mapCategories = mapParent
    ? childCategories(allCategories, mapParent.id, mode)
    : allTableCategories;
  const transactionsHref = `/money/transactions?${transactionsFeedQuery({
    start: period.start,
    end: period.end,
    accountIds,
    categoryId,
    merchantName,
    mode,
  })}`;

  if (!personId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">{t("money.spendingTitle")}</h1>
          {!isMobile ? (
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              {t("money.spendingCurrencyNote", { currency: REPORT_CURRENCY })}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "flex min-w-0 gap-2",
            isMobile
              ? "flex-col"
              : "flex-nowrap items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
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
        </div>
        <a
          href={transactionsHref}
          target={isMobile ? undefined : "_blank"}
          rel={isMobile ? undefined : "noreferrer"}
          data-testid="spending-view-transactions"
          className="inline-flex w-fit whitespace-nowrap text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {isMobile
            ? t("money.spendingViewTransactionsShort")
            : t("money.spendingViewTransactions")}
        </a>
      </div>

      {categoryId || merchantName ? (
        <div className="flex flex-wrap gap-2">
          {categoryId ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-foreground py-1 pl-3 pr-1 text-sm text-background">
              {filterCategory
                ? t("money.spendingFilterChip", { name: categoryName(filterCategory, locale) })
                : t("money.spendingFilterUnnamed")}
              <button
                type="button"
                aria-label={t("money.spendingClearFilter")}
                onClick={() => setCategoryFilter(null)}
                className="rounded-full bg-background/20 p-1"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
          {merchantName ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-foreground py-1 pl-3 pr-1 text-sm text-background">
              {t("money.spendingFilterChipMerchant", { name: merchantName })}
              <button
                type="button"
                aria-label={t("money.spendingClearFilter")}
                onClick={() => setMerchantFilter(null)}
                className="rounded-full bg-background/20 p-1"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
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
                        updateParams((params) => {
                          if (value === "income") params.set("mode", "income");
                          else params.delete("mode");
                        });
                      }}
                      className={cn(
                        "whitespace-nowrap rounded-md px-3 py-1 text-sm",
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
              <p className="truncate whitespace-nowrap text-sm text-muted-foreground">
                {t(isMobile ? "money.spendingCategoriesHintTouch" : "money.spendingCategoriesHint")}
              </p>
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
                  t={t}
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

          {tableCategories.length > 0 ? (
            <div className="space-y-2">
              {isMobile ? (
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
              ) : (
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
              )}
              {allTableCategories.length > LIST_TOP_N ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllCategories((current) => !current)}
                >
                  {showAllCategories ? t("money.spendingShowTop") : t("money.spendingShowAll")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            <DaysChart report={report} mode={mode} t={t} locale={locale} />
            <MerchantList
              report={report}
              t={t}
              locale={locale}
              showAll={showAllMerchants}
              onShowAll={setShowAllMerchants}
              onSelect={setMerchantFilter}
            />
          </div>
        </>
      )}
    </div>
  );
}
