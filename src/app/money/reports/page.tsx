"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  BadgeAlert,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  useCreateMoneyTransferSelfAlias,
  useDeleteMoneyBudgetTarget,
  useDeleteMoneyTransferSelfAlias,
  useIsMobile,
  useMoneyBudgetReport,
  useMoneyTransferSelfAliases,
  useUpsertMoneyBudgetTarget,
} from "@/hooks";
import { useIntlLocale } from "@/lib/date-locale";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import type { MoneyBudgetCategoryNode, MoneyBudgetChartMode } from "@/types";
import { MONEY_CURRENCIES } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

const DEFAULT_REPORT_CURRENCY = "RUB";
const COLORS = ["#2563eb", "#d97706", "#059669", "#dc2626", "#7c3aed", "#0f766e", "#64748b"];

type TargetEditorState = { categoryId: string; direction: "income" | "expense"; amount: string };
type Translate = (key: string) => string;

function currentMonthParam() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isMonthParam(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function monthStart(value: string) {
  return `${value}-01`;
}

function shiftMonth(value: string, delta: number) {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string, locale: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function targetEditorFromNode(node: MoneyBudgetCategoryNode): TargetEditorState {
  const targetAmount = node.target?.target_amount ?? node.target_amount;
  return {
    categoryId: node.id,
    direction: targetAmount < 0 ? "expense" : "income",
    amount: targetAmount === 0 ? "" : String(Math.abs(targetAmount)),
  };
}

function formatTooltipMoney(
  value: number | string | readonly (number | string)[] | undefined,
  currency: string,
  locale: string,
) {
  const firstValue = Array.isArray(value) ? value[0] : value;
  const numericValue =
    typeof firstValue === "number"
      ? firstValue
      : typeof firstValue === "string"
        ? Number(firstValue)
        : 0;
  return formatMoney(Number.isFinite(numericValue) ? numericValue : 0, currency, locale);
}

function flattenCategories(
  nodes: MoneyBudgetCategoryNode[],
  map = new Map<string, MoneyBudgetCategoryNode>(),
) {
  nodes.forEach((node) => {
    map.set(node.id, node);
    flattenCategories(node.children, map);
  });
  return map;
}

function categoryPath(nodes: MoneyBudgetCategoryNode[], categoryId: string): string[] | null {
  for (const node of nodes) {
    if (node.id === categoryId) return [node.id];
    const child = categoryPath(node.children, categoryId);
    if (child) return [node.id, ...child];
  }
  return null;
}

function actualForMode(node: MoneyBudgetCategoryNode, mode: MoneyBudgetChartMode) {
  if (mode === "income") return node.actual_income;
  if (mode === "expenses") return Math.abs(node.actual_expenses);
  return Math.abs(node.actual_net);
}

function targetForMode(node: MoneyBudgetCategoryNode, mode: MoneyBudgetChartMode) {
  if (mode === "income") return node.target_amount > 0 ? node.target_amount : 0;
  if (mode === "expenses") return node.target_amount < 0 ? Math.abs(node.target_amount) : 0;
  return Math.abs(node.target_amount);
}

function BudgetTargetEditor({
  node,
  editorState,
  isSaving,
  isDeleting,
  onDirectionChange,
  onAmountChange,
  onSave,
  onDelete,
  onCancel,
  t,
}: {
  node: MoneyBudgetCategoryNode;
  editorState: TargetEditorState;
  isSaving: boolean;
  isDeleting: boolean;
  onDirectionChange: (direction: "income" | "expense") => void;
  onAmountChange: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
  t: Translate;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{node.name_en}</p>
        <p className="text-xs text-muted-foreground">{t("money.reportTargetEditorDescription")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["expense", "income"] as const).map((direction) => (
          <Button
            key={direction}
            type="button"
            size="sm"
            variant={editorState.direction === direction ? "secondary" : "outline"}
            onClick={() => onDirectionChange(direction)}
          >
            {direction === "expense"
              ? t("money.reportDirectionExpense")
              : t("money.reportDirectionIncome")}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("money.reportTargetAmount")}</label>
        <Input
          autoFocus
          inputMode="decimal"
          value={editorState.amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder="0"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onSave} disabled={isSaving}>
          {t("common.save")}
        </Button>
        {node.target ? (
          <Button type="button" variant="outline" onClick={onDelete} disabled={isDeleting}>
            {t("common.delete")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

function SummaryMetric({
  title,
  value,
  hint,
  icon: Icon,
  accent,
  testId,
}: {
  title: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  testId?: string;
}) {
  return (
    <Card
      data-testid={testId}
      className="border-border/70 bg-gradient-to-br from-background via-background to-muted/40"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardDescription className="text-xs uppercase tracking-[0.16em]">
              {title}
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tracking-tight">{value}</CardTitle>
          </div>
          <div className={cn("rounded-full border p-2", accent)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

export default function MoneyReportsPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const intlLocale = useIntlLocale();
  const isMobile = useIsMobile();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const paramsString = searchParams?.toString() ?? "";
  const rawMonth = searchParams?.get("month") ?? null;
  const rawCurrency = (searchParams?.get("currency") ?? "").toUpperCase();
  const reportMonth = isMonthParam(rawMonth) ? rawMonth : currentMonthParam();
  const reportCurrency = MONEY_CURRENCIES.includes(rawCurrency as (typeof MONEY_CURRENCIES)[number])
    ? rawCurrency
    : DEFAULT_REPORT_CURRENCY;
  const [chartMode, setChartMode] = useState<MoneyBudgetChartMode>("expenses");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [focusedCategoryId, setFocusedCategoryId] = useState<string | null>(null);
  const [desktopEditorId, setDesktopEditorId] = useState<string | null>(null);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [editorState, setEditorState] = useState<TargetEditorState | null>(null);
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const reportQuery = useMoneyBudgetReport(
    selectedPersonId,
    monthStart(reportMonth),
    reportCurrency,
  );
  const aliasesQuery = useMoneyTransferSelfAliases(selectedPersonId);
  const upsertTarget = useUpsertMoneyBudgetTarget();
  const deleteTarget = useDeleteMoneyBudgetTarget();
  const createAlias = useCreateMoneyTransferSelfAlias();
  const deleteAlias = useDeleteMoneyTransferSelfAlias();
  const report = reportQuery.data;
  const categoryMap = useMemo(
    () => flattenCategories(report?.categories ?? []),
    [report?.categories],
  );
  const activeEditorNode = editorState ? (categoryMap.get(editorState.categoryId) ?? null) : null;

  const rootSeries = useMemo(
    () =>
      (report?.categories ?? [])
        .map((node, index) => ({
          id: node.id,
          label: node.name_en,
          actual: actualForMode(node, chartMode),
          target: targetForMode(node, chartMode),
          value: actualForMode(node, chartMode),
          color: COLORS[index % COLORS.length],
        }))
        .filter((item) => item.actual !== 0 || item.target !== 0),
    [chartMode, report?.categories],
  );

  useEffect(() => {
    const next = new URLSearchParams(paramsString);
    let changed = false;
    if (next.get("month") !== reportMonth) {
      next.set("month", reportMonth);
      changed = true;
    }
    if ((next.get("currency") ?? "").toUpperCase() !== reportCurrency) {
      next.set("currency", reportCurrency);
      changed = true;
    }
    if (changed) {
      router.replace(`/money/reports?${next.toString()}`, { scroll: false });
    }
  }, [paramsString, reportCurrency, reportMonth, router]);

  useEffect(() => {
    if (!focusedCategoryId) return;
    const target = rowRefs.current[focusedCategoryId];
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedCategoryId, report?.categories]);

  function updateParams(update: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(paramsString);
    update(next);
    router.replace(`/money/reports?${next.toString()}`, { scroll: false });
  }

  function focusCategory(categoryId: string) {
    const path = categoryPath(report?.categories ?? [], categoryId);
    if (path && path.length > 1) {
      setExpandedIds((current) => {
        const next = new Set(current);
        path.slice(0, -1).forEach((id) => next.add(id));
        return next;
      });
    }
    setFocusedCategoryId(categoryId);
  }

  function openEditor(node: MoneyBudgetCategoryNode) {
    setEditorState(targetEditorFromNode(node));
    if (isMobile) setMobileEditorOpen(true);
    else setDesktopEditorId(node.id);
  }

  function closeEditor() {
    setDesktopEditorId(null);
    setMobileEditorOpen(false);
    setEditorState(null);
  }

  function renderTargetEditor(node: MoneyBudgetCategoryNode) {
    if (!editorState || editorState.categoryId !== node.id) return null;
    return (
      <BudgetTargetEditor
        node={node}
        editorState={editorState}
        isSaving={upsertTarget.isPending}
        isDeleting={deleteTarget.isPending}
        onDirectionChange={(direction) =>
          setEditorState((current) => (current ? { ...current, direction } : current))
        }
        onAmountChange={(amount) =>
          setEditorState((current) => (current ? { ...current, amount } : current))
        }
        onSave={saveTarget}
        onDelete={() => removeTarget(node)}
        onCancel={closeEditor}
        t={t}
      />
    );
  }

  async function saveTarget() {
    if (!selectedPersonId || !editorState) return;
    const amount = Number(editorState.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t("money.reportTargetValidation"));
      return;
    }
    try {
      await upsertTarget.mutateAsync({
        personId: selectedPersonId,
        categoryId: editorState.categoryId,
        monthStart: monthStart(reportMonth),
        targetAmount: editorState.direction === "expense" ? -amount : amount,
        currency: reportCurrency,
      });
      toast.success(t("money.reportTargetSaved"));
      closeEditor();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.reportTargetSaveFailed"));
    }
  }

  async function removeTarget(node: MoneyBudgetCategoryNode) {
    if (!selectedPersonId) return;
    try {
      await deleteTarget.mutateAsync({
        personId: selectedPersonId,
        categoryId: node.id,
        monthStart: monthStart(reportMonth),
      });
      toast.success(t("money.reportTargetDeleted"));
      closeEditor();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.reportTargetDeleteFailed"));
    }
  }

  async function addAlias() {
    const value = aliasDraft.trim();
    if (!selectedPersonId || !value) {
      toast.error(t("money.reportAliasValidation"));
      return;
    }
    try {
      await createAlias.mutateAsync({ personId: selectedPersonId, alias: value });
      setAliasDraft("");
      toast.success(t("money.reportAliasSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.reportAliasSaveFailed"));
    }
  }

  async function removeAlias(id: string) {
    try {
      await deleteAlias.mutateAsync(id);
      toast.success(t("money.reportAliasDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.reportAliasDeleteFailed"));
    }
  }

  function AliasManagerContent() {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("money.reportSelfAliasesDescription")}</p>
        <div className="flex gap-2">
          <Input
            value={aliasDraft}
            onChange={(event) => setAliasDraft(event.target.value)}
            placeholder={t("money.reportAliasPlaceholder")}
          />
          <Button type="button" onClick={addAlias} disabled={createAlias.isPending}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t("common.add")}
          </Button>
        </div>
        <Separator />
        <div className="space-y-2">
          {(aliasesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("money.reportAliasesEmpty")}</p>
          ) : (
            (aliasesQuery.data ?? []).map((alias) => (
              <div
                key={alias.id}
                className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2"
              >
                <div>
                  <p className="font-medium">{alias.alias}</p>
                  <p className="text-xs text-muted-foreground">{alias.normalized_alias}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAlias(alias.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  function DesktopRows(nodes: MoneyBudgetCategoryNode[], level = 0): React.ReactNode {
    return nodes.map((node) => {
      const expanded = expandedIds.has(node.id);
      const hasChildren = node.children.length > 0;
      return (
        <React.Fragment key={node.id}>
          <div
            ref={(element) => {
              rowRefs.current[node.id] = element;
            }}
            data-testid={`budget-row-${node.id}`}
            className={cn(
              "grid grid-cols-[minmax(16rem,1.8fr),repeat(5,minmax(7rem,0.85fr)),auto] items-center gap-3 rounded-2xl px-4 py-3",
              focusedCategoryId === node.id ? "bg-secondary/80 shadow-sm" : "hover:bg-muted/40",
            )}
          >
            <div
              className="flex min-w-0 items-center gap-2"
              style={{ paddingLeft: `${level * 18}px` }}
            >
              {hasChildren ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() =>
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <span className="block h-7 w-7 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{node.name_en}</span>
                  {node.is_uncategorized ? (
                    <Badge variant="secondary">{t("money.reportUncategorizedBadge")}</Badge>
                  ) : null}
                  {node.target ? (
                    <Badge variant="outline">{t("money.reportTargetBadge")}</Badge>
                  ) : null}
                </div>
                {node.name_ru && node.name_ru !== node.name_en ? (
                  <p className="truncate text-xs text-muted-foreground">{node.name_ru}</p>
                ) : null}
              </div>
            </div>
            <span className="text-right text-sm">
              {formatMoney(node.actual_income, reportCurrency, intlLocale)}
            </span>
            <span className="text-right text-sm">
              {formatMoney(node.actual_expenses, reportCurrency, intlLocale)}
            </span>
            <span className="text-right text-sm font-medium">
              {formatMoney(node.actual_net, reportCurrency, intlLocale)}
            </span>
            <span className="text-right text-sm">
              {formatMoney(node.target_amount, reportCurrency, intlLocale)}
            </span>
            <span
              className={cn(
                "text-right text-sm font-medium",
                node.variance_amount > 0
                  ? "text-emerald-600"
                  : node.variance_amount < 0
                    ? "text-rose-600"
                    : "",
              )}
            >
              {formatMoney(node.variance_amount, reportCurrency, intlLocale)}
            </span>
            <div className="flex justify-end">
              <Popover
                open={desktopEditorId === node.id}
                onOpenChange={(open) => {
                  if (open) openEditor(node);
                  else if (desktopEditorId === node.id) closeEditor();
                }}
              >
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5">
                    <Pencil className="h-4 w-4" />
                    {t("money.reportEditTarget")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={8}
                  className="w-[24rem] rounded-2xl border-border/70 p-4"
                >
                  {renderTargetEditor(node)}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {hasChildren && expanded ? DesktopRows(node.children, level + 1) : null}
        </React.Fragment>
      );
    });
  }

  function MobileRows(nodes: MoneyBudgetCategoryNode[], level = 0): React.ReactNode {
    return nodes.map((node) => {
      const expanded = expandedIds.has(node.id);
      return (
        <div key={node.id} className="space-y-3">
          <Card
            ref={(element: HTMLDivElement | null) => {
              rowRefs.current[node.id] = element;
            }}
            data-testid={`budget-row-${node.id}`}
            className={focusedCategoryId === node.id ? "ring-1 ring-primary/40" : ""}
          >
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0" style={{ paddingLeft: `${level * 10}px` }}>
                  <div className="flex items-center gap-2">
                    {node.children.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setExpandedIds((current) => {
                            const next = new Set(current);
                            if (next.has(node.id)) next.delete(node.id);
                            else next.add(node.id);
                            return next;
                          })
                        }
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{node.name_en}</p>
                      {node.name_ru && node.name_ru !== node.name_en ? (
                        <p className="truncate text-xs text-muted-foreground">{node.name_ru}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => openEditor(node)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {t("money.reportActualIncome")}
                  </p>
                  <p>{formatMoney(node.actual_income, reportCurrency, intlLocale)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {t("money.reportActualExpenses")}
                  </p>
                  <p>{formatMoney(node.actual_expenses, reportCurrency, intlLocale)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {t("money.reportNet")}
                  </p>
                  <p>{formatMoney(node.actual_net, reportCurrency, intlLocale)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {t("money.reportTarget")}
                  </p>
                  <p>{formatMoney(node.target_amount, reportCurrency, intlLocale)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {t("money.reportVariance")}
                  </p>
                  <p
                    className={cn(
                      node.variance_amount > 0
                        ? "text-emerald-600"
                        : node.variance_amount < 0
                          ? "text-rose-600"
                          : "",
                    )}
                  >
                    {formatMoney(node.variance_amount, reportCurrency, intlLocale)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          {node.children.length > 0 && expanded ? (
            <div className="space-y-3 border-l border-dashed border-border/60 pl-3">
              {MobileRows(node.children, level + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  }

  if (!selectedPersonId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-[2rem] border border-border/70 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-5 py-6 text-slate-50 shadow-sm md:px-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge className="border-white/20 bg-white/10 text-white hover:bg-white/10">
              {t("money.reports")}
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {t("money.budgetReportTitle")}
              </h1>
              <p className="max-w-2xl text-sm text-slate-300">
                {t("money.budgetReportDescription")}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full text-white hover:bg-white/10 hover:text-white"
                onClick={() =>
                  updateParams((params) => params.set("month", shiftMonth(reportMonth, -1)))
                }
                aria-label={t("money.reportPreviousMonth")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[11rem] text-center text-sm font-medium">
                {monthLabel(reportMonth, intlLocale)}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full text-white hover:bg-white/10 hover:text-white"
                onClick={() =>
                  updateParams((params) => params.set("month", shiftMonth(reportMonth, 1)))
                }
                aria-label={t("money.reportNextMonth")}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <Select
              value={reportCurrency}
              onValueChange={(value) => updateParams((params) => params.set("currency", value))}
            >
              <SelectTrigger
                data-testid="budget-currency-select"
                className="w-[9rem] border-white/15 bg-white/5 text-white"
              >
                <SelectValue placeholder={t("money.currency")} />
              </SelectTrigger>
              <SelectContent>
                {MONEY_CURRENCIES.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              onClick={() => setAliasesOpen(true)}
            >
              <Target className="h-4 w-4" />
              {t("money.reportSelfAliases")}
            </Button>
          </div>
        </div>
      </div>
      {reportQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-8 w-32" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      {!reportQuery.isLoading && reportQuery.error ? (
        <Card className="border-rose-200 bg-rose-50/70">
          <CardContent className="flex items-start gap-3 p-5 text-rose-900">
            <BadgeAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">{t("money.reportLoadFailed")}</p>
              <p className="text-sm text-rose-800">
                {reportQuery.error instanceof Error
                  ? reportQuery.error.message
                  : t("money.reportLoadFailed")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!reportQuery.isLoading && report ? (
        <>
          {report.fx_status.mode === "approximate" ? (
            <Card className="border-amber-200 bg-amber-50/70">
              <CardContent className="flex items-start gap-3 p-5 text-amber-950">
                <BadgeAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">{t("money.reportFxApproximateTitle")}</p>
                  <p className="text-sm text-amber-900">
                    {report.fx_status.message ?? t("money.reportFxApproximateBody")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {report.fx_status.is_blocking ? (
            <Card className="border-rose-200 bg-rose-50/70">
              <CardContent className="flex items-start gap-3 p-5 text-rose-900">
                <BadgeAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">{t("money.reportFxMissingTitle")}</p>
                  <p className="text-sm text-rose-800">
                    {report.fx_status.message ?? t("money.reportFxMissingBody")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
                <SummaryMetric
                  title={t("money.reportActualIncome")}
                  value={formatMoney(report.summary.actual_income, reportCurrency, intlLocale)}
                  hint={t("money.reportActualIncomeHint")}
                  icon={TrendingUp}
                  accent="border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  testId="budget-summary-actual-income"
                />
                <SummaryMetric
                  title={t("money.reportActualExpenses")}
                  value={formatMoney(report.summary.actual_expenses, reportCurrency, intlLocale)}
                  hint={t("money.reportActualExpensesHint")}
                  icon={TrendingDown}
                  accent="border-rose-400/30 bg-rose-400/10 text-rose-200"
                  testId="budget-summary-actual-expenses"
                />
                <SummaryMetric
                  title={t("money.reportNet")}
                  value={formatMoney(report.summary.actual_net, reportCurrency, intlLocale)}
                  hint={t("money.reportActualNetHint")}
                  icon={Wallet}
                  accent="border-slate-300/30 bg-slate-200/10 text-slate-100"
                  testId="budget-summary-actual-net"
                />
                <SummaryMetric
                  title={t("money.reportTargetIncome")}
                  value={formatMoney(report.summary.target_income, reportCurrency, intlLocale)}
                  hint={t("money.reportTargetIncomeHint")}
                  icon={TrendingUp}
                  accent="border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  testId="budget-summary-target-income"
                />
                <SummaryMetric
                  title={t("money.reportTargetExpenses")}
                  value={formatMoney(report.summary.target_expenses, reportCurrency, intlLocale)}
                  hint={t("money.reportTargetExpensesHint")}
                  icon={TrendingDown}
                  accent="border-rose-400/30 bg-rose-400/10 text-rose-200"
                  testId="budget-summary-target-expenses"
                />
                <SummaryMetric
                  title={t("money.reportTargetNet")}
                  value={formatMoney(report.summary.target_net, reportCurrency, intlLocale)}
                  hint={t("money.reportTargetNetHint")}
                  icon={Target}
                  accent="border-amber-400/30 bg-amber-400/10 text-amber-200"
                  testId="budget-summary-target-net"
                />
                <SummaryMetric
                  title={t("money.reportVarianceNet")}
                  value={formatMoney(report.summary.variance_net, reportCurrency, intlLocale)}
                  hint={t("money.reportVarianceNetHint")}
                  icon={Wallet}
                  accent="border-sky-400/30 bg-sky-400/10 text-sky-200"
                  testId="budget-summary-variance-net"
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.35fr,1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("money.reportTrendTitle")}</CardTitle>
                    <CardDescription>{t("money.reportTrendDescription")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[19rem]" data-testid="budget-trend-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={report.trend}>
                          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                          <XAxis dataKey="date" tickLine={false} axisLine={false} />
                          <YAxis tickLine={false} axisLine={false} />
                          <Tooltip
                            formatter={(value) =>
                              formatTooltipMoney(value, reportCurrency, intlLocale)
                            }
                          />
                          <ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.4} />
                          <Line
                            type="monotone"
                            dataKey="income"
                            stroke="#16a34a"
                            strokeWidth={2.5}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="expenses"
                            stroke="#dc2626"
                            strokeWidth={2.5}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="net"
                            stroke="#2563eb"
                            strokeWidth={2.5}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="space-y-3">
                    <div>
                      <CardTitle>{t("money.reportRootShareTitle")}</CardTitle>
                      <CardDescription>{t("money.reportRootShareDescription")}</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(["expenses", "income", "net"] as const).map((mode) => (
                        <Button
                          key={mode}
                          type="button"
                          size="sm"
                          variant={chartMode === mode ? "secondary" : "outline"}
                          onClick={() => setChartMode(mode)}
                        >
                          {t(
                            `money.reportChartMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`,
                          )}
                        </Button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="h-[17rem]" data-testid="budget-donut-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Tooltip
                            formatter={(value) =>
                              formatTooltipMoney(value, reportCurrency, intlLocale)
                            }
                          />
                          <Pie
                            data={rootSeries.filter((entry) => entry.value > 0)}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={56}
                            outerRadius={86}
                            paddingAngle={2}
                            onClick={(entry) => {
                              if (entry && typeof entry === "object" && "id" in entry) {
                                focusCategory(String(entry.id));
                              }
                            }}
                          >
                            {rootSeries
                              .filter((entry) => entry.value > 0)
                              .map((entry) => (
                                <Cell key={entry.id} fill={entry.color} />
                              ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {rootSeries.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {t("money.reportChartEmpty")}
                        </p>
                      ) : (
                        rootSeries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="flex w-full items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                            onClick={() => focusCategory(entry.id)}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className="block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: entry.color }}
                              />
                              <span className="text-sm font-medium">{entry.label}</span>
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {formatMoney(entry.actual, reportCurrency, intlLocale)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t("money.reportRootComparisonTitle")}</CardTitle>
                  <CardDescription>{t("money.reportRootComparisonDescription")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[18rem]" data-testid="budget-root-comparison-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rootSeries}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip
                          formatter={(value) =>
                            formatTooltipMoney(value, reportCurrency, intlLocale)
                          }
                        />
                        <Bar
                          dataKey="actual"
                          fill="#2563eb"
                          radius={[8, 8, 0, 0]}
                          onClick={(entry) => {
                            if (entry && typeof entry === "object" && "id" in entry) {
                              focusCategory(String(entry.id));
                            }
                          }}
                        />
                        <Bar
                          dataKey="target"
                          fill="#f59e0b"
                          radius={[8, 8, 0, 0]}
                          onClick={(entry) => {
                            if (entry && typeof entry === "object" && "id" in entry) {
                              focusCategory(String(entry.id));
                            }
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{t("money.reportCategoriesTitle")}</CardTitle>
                      <CardDescription>{t("money.reportCategoriesDescription")}</CardDescription>
                    </div>
                    <Badge variant="outline">{reportCurrency}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!isMobile ? (
                    <>
                      <div className="grid grid-cols-[minmax(16rem,1.8fr),repeat(5,minmax(7rem,0.85fr)),auto] gap-3 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        <span>{t("money.categories")}</span>
                        <span className="text-right">{t("money.reportActualIncome")}</span>
                        <span className="text-right">{t("money.reportActualExpenses")}</span>
                        <span className="text-right">{t("money.reportNet")}</span>
                        <span className="text-right">{t("money.reportTarget")}</span>
                        <span className="text-right">{t("money.reportVariance")}</span>
                        <span className="text-right">{t("common.edit")}</span>
                      </div>
                      <div className="space-y-1">{DesktopRows(report.categories)}</div>
                    </>
                  ) : (
                    <div className="space-y-3">{MobileRows(report.categories)}</div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      ) : null}

      <Dialog open={aliasesOpen && !isMobile} onOpenChange={setAliasesOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("money.reportSelfAliases")}</DialogTitle>
            <DialogDescription>{t("money.reportSelfAliasesDescription")}</DialogDescription>
          </DialogHeader>
          <AliasManagerContent />
        </DialogContent>
      </Dialog>

      <Sheet open={aliasesOpen && isMobile} onOpenChange={setAliasesOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>{t("money.reportSelfAliases")}</SheetTitle>
            <SheetDescription>{t("money.reportSelfAliasesDescription")}</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <AliasManagerContent />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={mobileEditorOpen} onOpenChange={setMobileEditorOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>
              {activeEditorNode?.name_en ?? t("money.reportTargetEditorTitle")}
            </SheetTitle>
            <SheetDescription>{t("money.reportTargetEditorDescription")}</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            {activeEditorNode ? renderTargetEditor(activeEditorNode) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
