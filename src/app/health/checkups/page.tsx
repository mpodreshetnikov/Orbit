"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Plus, CalendarCheck, Search, X, AlertCircle, Clock, CalendarPlus, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckupCard, MarkCompleteDialog, PlanDialog } from "@/components/checkups";
import { useCheckupItems, useMedicalRecords } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import type { CheckupItem, CheckupCategory, CHECKUP_CATEGORIES } from "@/types";

type StatusTab = "all" | "overdue" | "upcoming" | "inactive";
const TAB_VALUES: StatusTab[] = ["all", "overdue", "upcoming", "inactive"];
const CATEGORIES: CheckupCategory[] = ["lab", "imaging", "visit", "vaccination", "dental", "other"];

export default function CheckupsPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  
  // Filters
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CheckupCategory | "all">("all");
  
  // Mark complete dialog
  const [markCompleteItem, setMarkCompleteItem] = useState<CheckupItem | null>(null);
  const [markCompleteOpen, setMarkCompleteOpen] = useState(false);

  // Plan: single (from card) or batch (Plan selected)
  const [planItems, setPlanItems] = useState<CheckupItem[]>([]);
  const [planOpen, setPlanOpen] = useState(false);

  // Selection mode for batch plan
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: items, isLoading } = useCheckupItems(selectedPersonId ?? null, {});
  const { data: records } = useMedicalRecords(
    selectedPersonId ? { person_id: selectedPersonId } : {}
  );

  const handleMarkComplete = (item: CheckupItem) => {
    setMarkCompleteItem(item);
    setMarkCompleteOpen(true);
  };

  const handlePlan = (item: CheckupItem) => {
    setPlanItems([item]);
    setPlanOpen(true);
  };

  const handleToggleSelect = (item: CheckupItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const handlePlanSelected = () => {
    if (!items || selectedIds.size === 0) return;
    const selected = items.filter((i) => selectedIds.has(i.id));
    setPlanItems(selected);
    setPlanOpen(true);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // Filter and group items (overdue / upcoming / later / inactive for "All" tab)
  const { filteredItems, overdueItems, upcomingItems, laterItems, restItems, overdueCount, upcomingCount, laterCount, inactiveCount } = useMemo(() => {
    if (!items) {
      return {
        filteredItems: [],
        overdueItems: [],
        upcomingItems: [],
        laterItems: [],
        restItems: [],
        overdueCount: 0,
        upcomingCount: 0,
        laterCount: 0,
        inactiveCount: 0,
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const weekFromToday = new Date();
    weekFromToday.setDate(weekFromToday.getDate() + 7);
    const weekFromTodayStr = weekFromToday.toISOString().slice(0, 10);

    // Category filter
    let filtered = items;
    if (categoryFilter !== "all") {
      filtered = filtered.filter((i) => i.category === categoryFilter);
    }

    // Search filter
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter((i) =>
        i.title.toLowerCase().includes(q)
      );
    }

    // Groups for "All" tab: overdue, upcoming (within 7 days), later (due after 7 days), inactive
    const overdue = filtered.filter(
      (i) =>
        i.status === "active" &&
        ((i.next_due_at && i.next_due_at < today) ||
          (i.planned_on && i.planned_on < today))
    );
    const overdueIds = new Set(overdue.map((i) => i.id));
    const upcoming = filtered.filter(
      (i) =>
        !overdueIds.has(i.id) &&
        i.status === "active" &&
        i.next_due_at &&
        i.next_due_at >= today &&
        i.next_due_at <= weekFromTodayStr
    );
    const later = filtered.filter(
      (i) =>
        !overdueIds.has(i.id) &&
        i.status === "active" &&
        i.next_due_at &&
        i.next_due_at > weekFromTodayStr
    );
    const rest = filtered.filter(
      (i) =>
        i.status !== "active" ||
        (!i.next_due_at && !(i.planned_on && i.planned_on < today))
    );

    // Apply status tab filter (single list when a tab is selected)
    let result = filtered;
    if (statusTab === "overdue") result = overdue;
    else if (statusTab === "upcoming") result = upcoming;
    else if (statusTab === "inactive") result = rest;

    return {
      filteredItems: result,
      overdueItems: overdue,
      upcomingItems: upcoming,
      laterItems: later,
      restItems: rest,
      overdueCount: overdue.length,
      upcomingCount: upcoming.length,
      laterCount: later.length,
      inactiveCount: rest.length,
    };
  }, [items, debouncedSearch, categoryFilter, statusTab]);

  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setStatusTab("all");
  };

  const hasActiveFilters = searchQuery || categoryFilter !== "all" || statusTab !== "all";

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold truncate min-w-0">{t("checkups.navTitle")}</h1>
        <div className="flex items-center gap-2 shrink-0">
          {selectionMode ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handlePlanSelected}
                disabled={selectedIds.size === 0}
              >
                <CalendarPlus className="h-4 w-4" />
                {t("checkups.planSelected")}{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={exitSelectionMode}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setSelectionMode(true)}
              >
                <CheckSquare className="h-4 w-4" />
                {t("checkups.selectToPlan")}
              </Button>
              <Link href="/health/checkups/new">
                <Button size="sm" className="shrink-0 gap-1.5">
                  <Plus className="h-4 w-4" />
                  {t("checkups.add")}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto">
        <Button
          variant={statusTab === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusTab("all")}
          className="shrink-0"
        >
          {t("checkups.all")}
        </Button>
        <Button
          variant={statusTab === "overdue" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusTab("overdue")}
          className={cn("shrink-0 gap-1", overdueCount > 0 && statusTab !== "overdue" && "text-amber-600 dark:text-amber-400")}
        >
          <AlertCircle className="h-4 w-4" />
          {t("checkups.overdue")}
          {overdueCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {overdueCount}
            </Badge>
          )}
        </Button>
        <Button
          variant={statusTab === "upcoming" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusTab("upcoming")}
          className="shrink-0 gap-1"
        >
          <Clock className="h-4 w-4" />
          {t("checkups.upcoming")}
          {upcomingCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {upcomingCount}
            </Badge>
          )}
        </Button>
        <Button
          variant={statusTab === "inactive" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusTab("inactive")}
          className="shrink-0"
        >
          {t("checkups.inactive")}
          {inactiveCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs text-muted-foreground">
              {inactiveCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Search and category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("common.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="tap-target absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select
          value={categoryFilter}
          onValueChange={(value) => setCategoryFilter(value as CheckupCategory | "all")}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t("checkups.category")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("records.allTypes")}</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {t(`checkups.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Active filters display */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">{t("common.filter")}:</span>
          {searchQuery && (
            <Badge variant="secondary" className="gap-1">
              &quot;{searchQuery}&quot;
              <button onClick={() => setSearchQuery("")}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {categoryFilter !== "all" && (
            <Badge variant="secondary" className="gap-1">
              {t(`checkups.category${categoryFilter.charAt(0).toUpperCase() + categoryFilter.slice(1)}`)}
              <button onClick={() => setCategoryFilter("all")}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {statusTab !== "all" && (
            <Badge variant="secondary" className="gap-1">
              {t(`checkups.${statusTab}`)}
              <button onClick={() => setStatusTab("all")}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 px-2 text-xs">
            {t("common.clear")}
          </Button>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <CalendarCheck className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">{t("checkups.noItems")}</p>
          <p className="text-sm mt-1">{t("checkups.noItemsHint")}</p>
          <Link href="/health/checkups/new">
            <Button size="sm" className="mt-3">{t("checkups.add")}</Button>
          </Link>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>{t("common.noResults")}</p>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2">
            {t("common.clear")}
          </Button>
        </div>
      ) : statusTab === "all" ? (
        <div className="space-y-8">
          {overdueItems.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 mb-3">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {t("checkups.overdue")}
                <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1">
                  {overdueItems.length}
                </Badge>
              </h2>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                {overdueItems.map((item) => (
                  <CheckupCard
                    key={item.id}
                    item={item}
                    onMarkComplete={handleMarkComplete}
                    onPlan={handlePlan}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={handleToggleSelect}
                  />
                ))}
              </div>
            </section>
          )}
          {upcomingItems.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                <Clock className="h-4 w-4 shrink-0" />
                {t("checkups.upcoming")}
                <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1 text-muted-foreground">
                  {upcomingItems.length}
                </Badge>
              </h2>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                {upcomingItems.map((item) => (
                  <CheckupCard
                    key={item.id}
                    item={item}
                    onMarkComplete={handleMarkComplete}
                    onPlan={handlePlan}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={handleToggleSelect}
                  />
                ))}
              </div>
            </section>
          )}
          {laterItems.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                <CalendarCheck className="h-4 w-4 shrink-0" />
                {t("checkups.later")}
                <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1 text-muted-foreground">
                  {laterItems.length}
                </Badge>
              </h2>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                {laterItems.map((item) => (
                  <CheckupCard
                    key={item.id}
                    item={item}
                    onMarkComplete={handleMarkComplete}
                    onPlan={handlePlan}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={handleToggleSelect}
                  />
                ))}
              </div>
            </section>
          )}
          {restItems.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                {t("checkups.inactive")}
                <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1 text-muted-foreground">
                  {restItems.length}
                </Badge>
              </h2>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                {restItems.map((item) => (
                  <CheckupCard
                    key={item.id}
                    item={item}
                    onMarkComplete={handleMarkComplete}
                    onPlan={handlePlan}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={handleToggleSelect}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {filteredItems.map((item) => (
            <CheckupCard
              key={item.id}
              item={item}
              onMarkComplete={handleMarkComplete}
              onPlan={handlePlan}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </div>
      )}

      <MarkCompleteDialog
        open={markCompleteOpen}
        onOpenChange={setMarkCompleteOpen}
        item={markCompleteItem}
        records={records ?? []}
        onSaved={() => setMarkCompleteItem(null)}
      />

      <PlanDialog
        open={planOpen}
        onOpenChange={(open) => {
          setPlanOpen(open);
          if (!open) {
            setPlanItems([]);
            exitSelectionMode();
          }
        }}
        items={planItems}
        onSaved={() => {
          setPlanItems([]);
          setPlanOpen(false);
          exitSelectionMode();
        }}
      />
    </div>
  );
}
