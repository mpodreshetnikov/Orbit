"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Plus,
  ReceiptText,
  RotateCcw,
  Scale,
  Search,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import {
  useInfiniteMoneyTransactionFeed,
  useIsMobile,
  useMoneyAccounts,
  useMoneyCategories,
  useMoneyTransaction,
  useMoneyTransactionFeedSummary,
} from "@/hooks";
import { useDateFnsLocale, useIntlLocale } from "@/lib/date-locale";
import { formatMoney } from "@/lib/money";
import { useUIStore } from "@/stores/ui-store";
import type {
  MoneyAmountSignFilter,
  MoneyTransactionDatePreset,
  MoneyTransactionStatus,
  MoneyTransactionType,
  MoneyTransferFilter,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const SEARCH_DEBOUNCE_MS = 250;
const SUMMARY_COLLAPSE_SCROLL_TOP = 24;
const HEADER_ROW_HEIGHT = 44;
const TRANSACTION_ROW_HEIGHT = 88;
const VIRTUAL_OVERSCAN = 6;
const VIRTUAL_THRESHOLD = 30;

const TRANSACTION_TYPES: MoneyTransactionType[] = [
  "expense",
  "income",
  "transfer",
  "refund",
  "fee",
  "adjustment",
];
const TRANSACTION_STATUSES: MoneyTransactionStatus[] = ["posted", "pending", "cancelled"];
const TRANSFER_FILTERS: MoneyTransferFilter[] = ["all", "only", "exclude"];
const AMOUNT_SIGN_FILTERS: MoneyAmountSignFilter[] = ["all", "income", "expense"];
const DATE_PRESETS: MoneyTransactionDatePreset[] = ["all", "7d", "30d", "3m", "1y", "custom"];

type VirtualRow =
  | { key: string; kind: "date_header"; label: string }
  | {
      key: string;
      kind: "transaction";
      transactionId: string;
      merchant: string;
      operationIconUrl: string | null;
      amount: number;
      currency: string;
      comment: string | null;
      sourceComment: string | null;
      accountLabel: string | null;
      cardLabel: string | null;
      transactionType: MoneyTransactionType;
      status: MoneyTransactionStatus;
      categoryLabels: string[];
      lineItemTitles: string[];
    };

type FilterDraft = {
  accounts: string[];
  categories: string[];
  types: MoneyTransactionType[];
  statuses: MoneyTransactionStatus[];
  transfer: MoneyTransferFilter;
  sign: MoneyAmountSignFilter;
  preset: MoneyTransactionDatePreset;
  from: string | null;
  to: string | null;
};

const EMPTY_FILTER_DRAFT: FilterDraft = {
  accounts: [],
  categories: [],
  types: [],
  statuses: [],
  transfer: "all",
  sign: "all",
  preset: "all",
  from: null,
  to: null,
};

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function toggleListValue<T extends string>(current: T[], value: T): T[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function clampDateRange(preset: string | null, from: string | null, to: string | null) {
  if (preset === "custom") {
    return { from, to };
  }
  if (!preset || preset === "all") {
    return { from: null, to: null };
  }

  const end = new Date();
  const start = new Date(end);
  if (preset === "7d") start.setDate(end.getDate() - 7);
  if (preset === "30d") start.setDate(end.getDate() - 30);
  if (preset === "3m") start.setMonth(end.getMonth() - 3);
  if (preset === "1y") start.setFullYear(end.getFullYear() - 1);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function dateInputValue(value: string | null) {
  if (!value) return "";
  return format(new Date(value), "yyyy-MM-dd");
}

function dateInputToIso(value: string, boundary: "start" | "end") {
  if (!value) return null;
  return boundary === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

function getPreferredTransactionComment(
  comment: string | null | undefined,
  sourceComment: string | null | undefined,
) {
  const canonical = comment?.trim();
  if (canonical) return canonical;
  const source = sourceComment?.trim();
  return source || null;
}

function buildDraftFromSearchParams(searchParams: URLSearchParams): FilterDraft {
  return {
    accounts: parseCsv(searchParams.get("accounts")),
    categories: parseCsv(searchParams.get("categories")),
    types: parseCsv(searchParams.get("types")) as MoneyTransactionType[],
    statuses: parseCsv(searchParams.get("statuses")) as MoneyTransactionStatus[],
    transfer: (searchParams.get("transfer") ?? "all") as MoneyTransferFilter,
    sign: (searchParams.get("sign") ?? "all") as MoneyAmountSignFilter,
    preset: (searchParams.get("preset") ?? "all") as MoneyTransactionDatePreset,
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  };
}

function buildFilterQueryUpdates(draft: FilterDraft): Record<string, string | null> {
  return {
    accounts: draft.accounts.length > 0 ? draft.accounts.join(",") : null,
    categories: draft.categories.length > 0 ? draft.categories.join(",") : null,
    types: draft.types.length > 0 ? draft.types.join(",") : null,
    statuses: draft.statuses.length > 0 ? draft.statuses.join(",") : null,
    transfer: draft.transfer !== "all" ? draft.transfer : null,
    sign: draft.sign !== "all" ? draft.sign : null,
    preset: draft.preset !== "all" ? draft.preset : null,
    from: draft.preset === "custom" && draft.from ? draft.from : null,
    to: draft.preset === "custom" && draft.to ? draft.to : null,
  };
}

function countActiveFilters(draft: FilterDraft) {
  return (
    draft.accounts.length +
    draft.categories.length +
    draft.types.length +
    draft.statuses.length +
    (draft.transfer !== "all" ? 1 : 0) +
    (draft.sign !== "all" ? 1 : 0) +
    (draft.preset !== "all" ? 1 : 0)
  );
}

function getTransactionTypeIcon(type: MoneyTransactionType) {
  switch (type) {
    case "expense":
      return ArrowUpRight;
    case "income":
      return ArrowDownLeft;
    case "transfer":
      return ArrowRightLeft;
    case "refund":
      return RotateCcw;
    case "fee":
      return ReceiptText;
    case "adjustment":
      return Scale;
    default:
      return Wallet;
  }
}

function getTransactionTypeIconTone(type: MoneyTransactionType) {
  switch (type) {
    case "expense":
      return "bg-rose-100 text-rose-700";
    case "income":
      return "bg-emerald-100 text-emerald-700";
    case "transfer":
      return "bg-sky-100 text-sky-700";
    case "refund":
      return "bg-amber-100 text-amber-700";
    case "fee":
      return "bg-slate-200 text-slate-700";
    case "adjustment":
      return "bg-violet-100 text-violet-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function MoneyTransactionsPage() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const isMobile = useIsMobile();
  const dateLocale = useDateFnsLocale();
  const intlLocale = useIntlLocale();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const [isFilterOpen, setFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<FilterDraft>(EMPTY_FILTER_DRAFT);
  const [accountSearchDraft, setAccountSearchDraft] = useState("");
  const [categorySearchDraft, setCategorySearchDraft] = useState("");

  const paramsKey = searchParams.toString();
  const parsedQuery = searchParams.get("q") ?? "";
  const appliedFilters = useMemo(() => buildDraftFromSearchParams(searchParams), [searchParams]);
  const selectedTransactionId = searchParams.get("tx");
  const { from, to } = clampDateRange(
    appliedFilters.preset,
    appliedFilters.from,
    appliedFilters.to,
  );
  const [searchDraft, setSearchDraft] = useState(parsedQuery);

  useEffect(() => {
    setSearchDraft(parsedQuery);
  }, [parsedQuery]);

  useEffect(() => {
    if (isFilterOpen) return;
    setDraftFilters(appliedFilters);
  }, [appliedFilters, isFilterOpen]);

  const { data: accounts } = useMoneyAccounts(selectedPersonId);
  const { data: categories } = useMoneyCategories();
  const feedFilters = useMemo(
    () => ({
      query: parsedQuery,
      accountIds: appliedFilters.accounts,
      transactionTypes: appliedFilters.types,
      statuses: appliedFilters.statuses,
      categoryIds: appliedFilters.categories,
      transferFilter: appliedFilters.transfer,
      amountSign: appliedFilters.sign,
      preset: appliedFilters.preset,
      from,
      to,
    }),
    [appliedFilters, from, parsedQuery, to],
  );
  const feedQuery = useInfiniteMoneyTransactionFeed(selectedPersonId, feedFilters);
  const feedSummaryQuery = useMoneyTransactionFeedSummary(selectedPersonId, feedFilters);
  const { data: transaction } = useMoneyTransaction(selectedTransactionId);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    setViewportHeight(node.clientHeight);
  }, [feedQuery.data?.pages.length]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchDraft === parsedQuery) return;
      const next = new URLSearchParams(paramsKey);
      if (searchDraft.trim()) {
        next.set("q", searchDraft.trim());
      } else {
        next.delete("q");
      }
      const nextQuery = next.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [paramsKey, parsedQuery, pathname, router, searchDraft]);

  const accountNameById = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.id, account.account_label])),
    [accounts],
  );
  const accountCurrencyById = useMemo(
    () => new Map((accounts ?? []).map((account) => [account.id, account.currency])),
    [accounts],
  );
  const categoryNameById = useMemo(
    () =>
      new Map(
        (categories ?? []).map((category) => [
          category.id,
          `${category.name_en} / ${category.name_ru}`,
        ]),
      ),
    [categories],
  );

  const transactions = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [feedQuery.data?.pages],
  );

  const summaryCurrency =
    transactions[0]?.currency ?? accountCurrencyById.get(appliedFilters.accounts[0] ?? "") ?? "USD";
  const activeFilterCount = countActiveFilters(appliedFilters);
  const hasStructuredFilters = activeFilterCount > 0;
  const isSummaryCollapsed = scrollTop > SUMMARY_COLLAPSE_SCROLL_TOP;

  const appliedFilterChips = useMemo(() => {
    const chips: string[] = [];

    appliedFilters.accounts.forEach((accountId) => {
      chips.push(accountNameById.get(accountId) ?? accountId);
    });
    appliedFilters.categories.forEach((categoryId) => {
      chips.push(categoryNameById.get(categoryId) ?? categoryId);
    });
    appliedFilters.types.forEach((type) => {
      chips.push(t(`money.transactionType${type.charAt(0).toUpperCase()}${type.slice(1)}`));
    });
    appliedFilters.statuses.forEach((status) => {
      chips.push(t(`money.transactionStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`));
    });
    if (appliedFilters.transfer !== "all") {
      chips.push(
        t(
          `money.transferFilter${appliedFilters.transfer.charAt(0).toUpperCase()}${appliedFilters.transfer.slice(1)}`,
        ),
      );
    }
    if (appliedFilters.sign !== "all") {
      chips.push(
        t(
          `money.amountSign${appliedFilters.sign.charAt(0).toUpperCase()}${appliedFilters.sign.slice(1)}`,
        ),
      );
    }
    if (appliedFilters.preset !== "all") {
      chips.push(t(`money.datePreset${appliedFilters.preset}`));
    }

    return chips;
  }, [accountNameById, appliedFilters, categoryNameById, t]);

  const rows = useMemo<VirtualRow[]>(() => {
    const nextRows: VirtualRow[] = [];
    let currentDateLabel: string | null = null;

    for (const item of transactions) {
      const dateLabel = format(new Date(item.posted_at), "EEEE, MMM d", {
        locale: dateLocale,
      });

      if (dateLabel !== currentDateLabel) {
        currentDateLabel = dateLabel;
        nextRows.push({
          key: `header-${dateLabel}`,
          kind: "date_header",
          label: dateLabel,
        });
      }

      nextRows.push({
        key: item.id,
        kind: "transaction",
        transactionId: item.id,
        merchant: item.merchant_name || t("money.transactionFallback"),
        operationIconUrl: item.operation_icon_url ?? null,
        amount: item.amount,
        currency: item.currency,
        comment: item.comment,
        sourceComment: item.source_comment ?? null,
        accountLabel: accountNameById.get(item.account_id) ?? null,
        cardLabel: item.money_cards?.card_label ?? null,
        transactionType: item.transaction_type,
        status: item.status,
        categoryLabels: item.category_ids
          .map((categoryId) => categoryNameById.get(categoryId) ?? categoryId)
          .slice(0, 2),
        lineItemTitles: item.line_item_titles
          .map((title) => title.trim())
          .filter(Boolean)
          .slice(0, 3),
      });
    }

    return nextRows;
  }, [accountNameById, categoryNameById, dateLocale, t, transactions]);

  const shouldVirtualize = rows.length >= VIRTUAL_THRESHOLD;
  const virtual = useMemo(() => {
    if (!shouldVirtualize || rows.length === 0) {
      return {
        start: 0,
        end: rows.length,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const offsets = new Array<number>(rows.length + 1).fill(0);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const estimatedHeight =
        measuredHeights[row.key] ??
        (row.kind === "date_header" ? HEADER_ROW_HEIGHT : TRANSACTION_ROW_HEIGHT);
      offsets[index + 1] = offsets[index]! + estimatedHeight;
    }

    const viewportBottom = scrollTop + viewportHeight;
    let start = 0;
    while (start < rows.length && offsets[start + 1]! < scrollTop) start += 1;
    let end = start;
    while (end < rows.length && offsets[end]! <= viewportBottom) end += 1;

    start = Math.max(0, start - VIRTUAL_OVERSCAN);
    end = Math.min(rows.length, end + VIRTUAL_OVERSCAN);

    return {
      start,
      end,
      topSpacer: offsets[start] ?? 0,
      bottomSpacer: (offsets[rows.length] ?? 0) - (offsets[end] ?? 0),
    };
  }, [measuredHeights, rows, scrollTop, shouldVirtualize, viewportHeight]);

  const visibleRows = useMemo(
    () => rows.slice(virtual.start, virtual.end),
    [rows, virtual.end, virtual.start],
  );

  const filteredAccounts = useMemo(() => {
    const needle = accountSearchDraft.trim().toLowerCase();
    if (!needle) return accounts ?? [];
    return (accounts ?? []).filter((account) =>
      account.account_label.toLowerCase().includes(needle),
    );
  }, [accountSearchDraft, accounts]);

  const filteredCategories = useMemo(() => {
    const needle = categorySearchDraft.trim().toLowerCase();
    if (!needle) return categories ?? [];
    return (categories ?? []).filter((category) =>
      `${category.name_en} ${category.name_ru}`.toLowerCase().includes(needle),
    );
  }, [categories, categorySearchDraft]);

  const selectedCategoryOptions = useMemo(
    () =>
      draftFilters.categories
        .map((categoryId) => categories?.find((category) => category.id === categoryId) ?? null)
        .filter((category): category is NonNullable<typeof categories>[number] =>
          Boolean(category),
        ),
    [categories, draftFilters.categories],
  );

  const updateQueryParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(paramsKey);
    for (const [key, value] of Object.entries(updates)) {
      if (value && value.length > 0) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    const nextQuery = next.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  const openFilters = () => {
    setDraftFilters(appliedFilters);
    setAccountSearchDraft("");
    setCategorySearchDraft("");
    setFilterOpen(true);
  };

  const closeFilters = () => {
    setFilterOpen(false);
  };

  const applyFilters = () => {
    updateQueryParams(buildFilterQueryUpdates(draftFilters));
    setFilterOpen(false);
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTER_DRAFT);
    updateQueryParams(buildFilterQueryUpdates(EMPTY_FILTER_DRAFT));
    setFilterOpen(false);
  };

  const handleOpenTransaction = (transactionId: string) => {
    updateQueryParams({ tx: transactionId });
  };

  const handleCloseTransaction = () => {
    updateQueryParams({ tx: null });
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    setScrollTop(node.scrollTop);
    setViewportHeight(node.clientHeight);

    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceToBottom < 320 && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
      void feedQuery.fetchNextPage();
    }
  };

  const trackRowHeight = (key: string, node: HTMLDivElement | null) => {
    if (!node) return;
    const nextHeight = Math.ceil(node.getBoundingClientRect().height);
    setMeasuredHeights((current) =>
      current[key] === nextHeight ? current : { ...current, [key]: nextHeight },
    );
  };

  if (!selectedPersonId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  const filterPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-950">{t("money.filtersTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("money.filtersHint")}</p>
      </div>

      <div className="flex-1 min-h-0 space-y-5 overflow-y-auto px-5 py-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">{t("money.filterAccounts")}</h3>
            <Badge variant="outline">{draftFilters.accounts.length}</Badge>
          </div>
          <Input
            value={accountSearchDraft}
            onChange={(event) => setAccountSearchDraft(event.target.value)}
            placeholder={t("money.filterSearchAccounts")}
          />
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
            {filteredAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>
            ) : (
              filteredAccounts.map((account) => (
                <label
                  key={account.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm"
                >
                  <Checkbox
                    checked={draftFilters.accounts.includes(account.id)}
                    onCheckedChange={() =>
                      setDraftFilters((current) => ({
                        ...current,
                        accounts: toggleListValue(current.accounts, account.id),
                      }))
                    }
                    aria-label={account.account_label}
                  />
                  <span className="text-sm text-slate-900">{account.account_label}</span>
                </label>
              ))
            )}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">{t("money.filterCategories")}</h3>
            <Badge variant="outline">{draftFilters.categories.length}</Badge>
          </div>
          <Input
            value={categorySearchDraft}
            onChange={(event) => setCategorySearchDraft(event.target.value)}
            placeholder={t("money.filterSearchCategories")}
          />
          {selectedCategoryOptions.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t("money.filterCategories")}
                </p>
                <Badge variant="secondary">{selectedCategoryOptions.length}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedCategoryOptions.map((category) => {
                  const categoryLabel = `${category.name_en} / ${category.name_ru}`;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() =>
                        setDraftFilters((current) => ({
                          ...current,
                          categories: current.categories.filter((item) => item !== category.id),
                        }))
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                    >
                      <span>{categoryLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
            {filteredCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>
            ) : (
              filteredCategories.map((category) => {
                const categoryLabel = `${category.name_en} / ${category.name_ru}`;
                return (
                  <label
                    key={category.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm"
                  >
                    <Checkbox
                      checked={draftFilters.categories.includes(category.id)}
                      onCheckedChange={() =>
                        setDraftFilters((current) => ({
                          ...current,
                          categories: toggleListValue(current.categories, category.id),
                        }))
                      }
                      aria-label={categoryLabel}
                    />
                    <span className="text-sm text-slate-900">{categoryLabel}</span>
                  </label>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{t("money.filterTypes")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {TRANSACTION_TYPES.map((type) => {
              const label = t(
                `money.transactionType${type.charAt(0).toUpperCase()}${type.slice(1)}`,
              );
              return (
                <label
                  key={type}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                >
                  <Checkbox
                    checked={draftFilters.types.includes(type)}
                    onCheckedChange={() =>
                      setDraftFilters((current) => ({
                        ...current,
                        types: toggleListValue(current.types, type),
                      }))
                    }
                    aria-label={label}
                  />
                  <span className="text-sm text-slate-900">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{t("money.filterStatuses")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {TRANSACTION_STATUSES.map((status) => {
              const label = t(
                `money.transactionStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`,
              );
              return (
                <label
                  key={status}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                >
                  <Checkbox
                    checked={draftFilters.statuses.includes(status)}
                    onCheckedChange={() =>
                      setDraftFilters((current) => ({
                        ...current,
                        statuses: toggleListValue(current.statuses, status),
                      }))
                    }
                    aria-label={label}
                  />
                  <span className="text-sm text-slate-900">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{t("money.filterTransfer")}</h3>
          <div className="grid grid-cols-3 gap-2">
            {TRANSFER_FILTERS.map((filter) => (
              <Button
                key={filter}
                type="button"
                variant={draftFilters.transfer === filter ? "default" : "outline"}
                onClick={() => setDraftFilters((current) => ({ ...current, transfer: filter }))}
              >
                {t(`money.transferFilter${filter.charAt(0).toUpperCase()}${filter.slice(1)}`)}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{t("money.filterAmountSign")}</h3>
          <div className="grid grid-cols-3 gap-2">
            {AMOUNT_SIGN_FILTERS.map((filter) => (
              <Button
                key={filter}
                type="button"
                variant={draftFilters.sign === filter ? "default" : "outline"}
                onClick={() => setDraftFilters((current) => ({ ...current, sign: filter }))}
              >
                {t(`money.amountSign${filter.charAt(0).toUpperCase()}${filter.slice(1)}`)}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{t("money.filterDateRange")}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant={draftFilters.preset === preset ? "default" : "outline"}
                onClick={() =>
                  setDraftFilters((current) => ({
                    ...current,
                    preset,
                    from: preset === "custom" ? current.from : null,
                    to: preset === "custom" ? current.to : null,
                  }))
                }
              >
                {t(`money.datePreset${preset}`)}
              </Button>
            ))}
          </div>
          {draftFilters.preset === "custom" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-slate-700">{t("money.filterFromDate")}</span>
                <Input
                  type="date"
                  value={dateInputValue(draftFilters.from)}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      from: dateInputToIso(event.target.value, "start"),
                    }))
                  }
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-700">{t("money.filterToDate")}</span>
                <Input
                  type="date"
                  value={dateInputValue(draftFilters.to)}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      to: dateInputToIso(event.target.value, "end"),
                    }))
                  }
                />
              </label>
            </div>
          ) : null}
        </section>
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
        <Button type="button" variant="ghost" onClick={clearFilters}>
          {t("common.clear")}
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={closeFilters}>
            {t("common.close")}
          </Button>
          <Button type="button" onClick={applyFilters}>
            {t("common.apply")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-10.5rem)] min-w-0 flex-col gap-4 overflow-hidden md:h-[calc(100dvh-7rem)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("money.transactions")}</h1>
          <p className="text-sm text-muted-foreground">{t("money.searchTransactions")}</p>
        </div>
        <Link href="/money/transactions/new">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("money.addTransaction")}
          </Button>
        </Link>
      </div>

      <section className="shrink-0 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] p-4 shadow-sm sm:p-5">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder={t("money.searchTransactions")}
                className="h-12 rounded-2xl border-slate-200 pl-11 text-base"
              />
            </div>

            {isMobile ? (
              <Button
                type="button"
                variant={hasStructuredFilters ? "default" : "outline"}
                aria-label={t("common.filter")}
                className="relative h-12 w-12 shrink-0 rounded-2xl px-0"
                onClick={openFilters}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 ? (
                  <Badge
                    variant="secondary"
                    className="absolute -right-1.5 -top-1.5 min-w-5 justify-center rounded-full px-1"
                  >
                    {activeFilterCount}
                  </Badge>
                ) : null}
              </Button>
            ) : (
              <Popover
                open={isFilterOpen}
                onOpenChange={(open) => (open ? openFilters() : closeFilters())}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant={hasStructuredFilters ? "default" : "outline"}
                    className="h-12 gap-2 rounded-2xl px-4"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    {t("common.filter")}
                    {activeFilterCount > 0 ? (
                      <Badge variant="secondary">{activeFilterCount}</Badge>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="max-h-[var(--radix-popover-content-available-height)] w-[min(92vw,30rem)] overflow-hidden p-0"
                >
                  {filterPanel}
                </PopoverContent>
              </Popover>
            )}
          </div>

          {hasStructuredFilters ? (
            <div className="flex flex-wrap gap-2">
              {appliedFilterChips.map((chip) => (
                <Badge key={chip} variant="outline" className="rounded-full px-3 py-1">
                  {chip}
                </Badge>
              ))}
            </div>
          ) : null}

          {hasStructuredFilters ? (
            <div
              data-testid="transaction-search-summary"
              data-collapsed={isSummaryCollapsed ? "true" : "false"}
              aria-hidden={isSummaryCollapsed}
              className={`overflow-hidden transition-all duration-200 ease-out ${
                isSummaryCollapsed
                  ? "max-h-0 -translate-y-2 opacity-0 pointer-events-none"
                  : "max-h-48 translate-y-0 opacity-100"
              }`}
            >
              <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t("money.summaryMatches")}
                  </p>
                  <p className="text-lg font-semibold text-slate-950">
                    {feedSummaryQuery.data?.totalCount ?? 0}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t("money.summaryPositive")}
                  </p>
                  <p className="text-lg font-semibold text-emerald-700">
                    {formatMoney(
                      feedSummaryQuery.data?.totalPositiveAmount ?? 0,
                      summaryCurrency,
                      intlLocale,
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t("money.summaryNegative")}
                  </p>
                  <p className="text-lg font-semibold text-rose-700">
                    {formatMoney(
                      feedSummaryQuery.data?.totalNegativeAmount ?? 0,
                      summaryCurrency,
                      intlLocale,
                    )}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="min-h-0 flex-1 overflow-hidden">
        {feedQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-[22px] border border-slate-200 bg-muted/40"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-[28px] border border-dashed p-10 text-center text-muted-foreground">
            <Wallet className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="font-medium">{t("money.noTransactions")}</p>
            <p className="mt-1 text-sm">{t("money.noTransactionsHint")}</p>
          </div>
        ) : (
          <div
            ref={listRef}
            data-testid="transaction-list"
            className="h-full overflow-y-auto rounded-[28px] border border-slate-200 bg-slate-50/70 p-3 sm:p-4"
            onScroll={handleScroll}
          >
            {virtual.topSpacer > 0 ? <div style={{ height: `${virtual.topSpacer}px` }} /> : null}

            <div className="space-y-3">
              {visibleRows.map((row) => {
                if (row.kind === "date_header") {
                  return (
                    <div
                      key={row.key}
                      ref={(node) => trackRowHeight(row.key, node)}
                      className="px-1 pt-2"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                        {row.label}
                      </p>
                    </div>
                  );
                }

                const preferredComment = getPreferredTransactionComment(
                  row.comment,
                  row.sourceComment,
                );

                return (
                  <div key={row.key} ref={(node) => trackRowHeight(row.key, node)}>
                    <button
                      type="button"
                      aria-label={row.merchant}
                      onClick={() => handleOpenTransaction(row.transactionId)}
                      className="w-full rounded-[22px] border border-slate-200 bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md sm:px-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div
                            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl ${getTransactionTypeIconTone(row.transactionType)}`}
                          >
                            {row.operationIconUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- transaction icons are stored as arbitrary remote URLs
                              <img
                                src={row.operationIconUrl}
                                alt=""
                                className="h-4 w-4 object-contain"
                              />
                            ) : (
                              React.createElement(getTransactionTypeIcon(row.transactionType), {
                                className: "h-4 w-4",
                                "aria-hidden": true,
                              })
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-semibold leading-5 text-slate-950 sm:text-base">
                                {row.merchant}
                              </p>
                              <p className="truncate text-xs leading-4 text-muted-foreground sm:text-sm">
                                {row.categoryLabels.join(", ") || t("money.categoryUnassigned")}
                              </p>
                            </div>

                            {preferredComment ? (
                              <p className="line-clamp-1 text-xs leading-4 text-slate-600 sm:text-sm">
                                {preferredComment}
                              </p>
                            ) : null}

                            {row.lineItemTitles.length > 0 ? (
                              <p className="line-clamp-1 text-xs leading-4 text-slate-500 sm:text-sm">
                                {row.lineItemTitles.join(", ")}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <p
                            className={`text-[15px] font-semibold leading-5 sm:text-base ${
                              row.amount < 0 ? "text-rose-700" : "text-emerald-700"
                            }`}
                          >
                            {formatMoney(row.amount, row.currency, intlLocale)}
                          </p>
                          <p className="max-w-32 truncate text-xs leading-4 text-muted-foreground sm:max-w-40 sm:text-sm">
                            {row.accountLabel ?? "-"}
                            {row.cardLabel ? ` / ${row.cardLabel}` : ""}
                          </p>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>

            {virtual.bottomSpacer > 0 ? (
              <div style={{ height: `${virtual.bottomSpacer}px` }} />
            ) : null}

            {feedQuery.isFetchingNextPage ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {isMobile ? (
        <Sheet open={isFilterOpen} onOpenChange={setFilterOpen}>
          <SheetContent
            side="bottom"
            className="[&>button]:hidden h-[100dvh] w-full rounded-t-[28px] border-0 p-0 sm:max-w-none"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("money.filtersTitle")}</SheetTitle>
              <SheetDescription>{t("money.filtersHint")}</SheetDescription>
            </SheetHeader>
            {filterPanel}
          </SheetContent>
        </Sheet>
      ) : null}

      <Sheet
        open={Boolean(selectedTransactionId)}
        onOpenChange={(open) => !open && handleCloseTransaction()}
      >
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={
            isMobile
              ? "[&>button]:hidden h-[100dvh] w-full rounded-t-[28px] border-0 p-0 sm:max-w-none"
              : "[&>button]:hidden w-full max-w-2xl border-l border-slate-200 p-0 sm:max-w-2xl"
          }
        >
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle>
                    {transaction?.merchant_name || t("money.transactionFallback")}
                  </SheetTitle>
                  <SheetDescription>{t("money.transactions")}</SheetDescription>
                </div>
                <Button type="button" variant="ghost" onClick={handleCloseTransaction}>
                  {t("common.close")}
                </Button>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {transaction ? (
                <div className="space-y-5">
                  <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {t(
                              `money.transactionType${
                                transaction.transaction_type.charAt(0).toUpperCase() +
                                transaction.transaction_type.slice(1)
                              }`,
                            )}
                          </Badge>
                          <Badge variant="outline">
                            {t(
                              `money.transactionStatus${
                                transaction.status.charAt(0).toUpperCase() +
                                transaction.status.slice(1)
                              }`,
                            )}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(transaction.posted_at), "PPPp", { locale: dateLocale })}
                        </p>
                        {transaction.comment ? <p>{transaction.comment}</p> : null}
                      </div>
                      <p
                        className={`text-3xl font-semibold ${
                          transaction.amount < 0 ? "text-rose-700" : "text-emerald-700"
                        }`}
                      >
                        {formatMoney(transaction.amount, transaction.currency, intlLocale)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {transaction.line_items.map((lineItem) => (
                      <div
                        key={lineItem.id ?? lineItem.title}
                        className="rounded-[22px] border border-slate-200 bg-white p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{lineItem.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {lineItem.category_id
                                ? (categoryNameById.get(lineItem.category_id) ??
                                  lineItem.category_id)
                                : t("money.categoryUnassigned")}
                            </p>
                          </div>
                          <p className="font-medium">
                            {formatMoney(lineItem.amount, transaction.currency, intlLocale)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Link href={`/money/transactions/${transaction.id}`} className="flex-1">
                      <Button type="button" variant="outline" className="w-full">
                        {t("common.edit")}
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed p-8 text-center text-muted-foreground">
                  {t("common.loading")}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
