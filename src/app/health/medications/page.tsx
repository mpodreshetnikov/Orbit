"use client";

import React from "react";
import { useRef, useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { List, Plus, Pill, Search, X, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { RegimenCard, MedicationDashboard } from "@/components/medications";
import {
  useRegimens,
  useUserPreferences,
  useUpdateUserPreferences,
  useMarkDoseTaken,
  useMarkDoseSkipped,
} from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import type { MedRegimenStatus } from "@/types";
import { getEffectiveStatus } from "@/types/regimen";

type StatusFilter = "all" | MedRegimenStatus;

export default function MedicationsPage() {
  const t = useTranslations();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const allMedsRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [overdueIntervalMinutes, setOverdueIntervalMinutes] = useState<number>(30);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: regimens, isLoading } = useRegimens(selectedPersonId ?? null);
  const { data: preferences } = useUserPreferences();
  const updatePreferences = useUpdateUserPreferences();
  const markTaken = useMarkDoseTaken();
  const markSkipped = useMarkDoseSkipped();
  const notificationHandledRef = useRef(false);

  // Handle notification action params (from service worker opening the app).
  // Runs once on mount; reads URL params directly from window.location to avoid
  // useSearchParams() which can cause infinite RSC refetches in Next.js App Router.
  useEffect(() => {
    if (notificationHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get("notification_action");
    const idsParam = params.get("dose_event_ids");
    if (!action || !idsParam) return;

    const doseEventIds = idsParam.split(",").filter(Boolean);
    if (doseEventIds.length === 0) return;

    notificationHandledRef.current = true;

    // Clear URL params to keep the address bar clean
    const url = new URL(window.location.href);
    url.searchParams.delete("notification_action");
    url.searchParams.delete("dose_event_ids");
    window.history.replaceState(null, "", url.pathname + url.search);

    // Execute the action
    const mutation = action === "taken" ? markTaken : markSkipped;
    for (const id of doseEventIds) {
      mutation.mutate(
        action === "taken"
          ? { doseEventId: id, takenAt: new Date().toISOString() }
          : { doseEventId: id },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (preferences?.overdue_reminder_interval_minutes != null) {
      setOverdueIntervalMinutes(preferences.overdue_reminder_interval_minutes);
    }
  }, [preferences?.overdue_reminder_interval_minutes]);

  const handleSaveOverdueInterval = async () => {
    const value = Math.max(1, Math.min(1440, overdueIntervalMinutes));
    setOverdueIntervalMinutes(value);
    await updatePreferences.mutateAsync({ overdue_reminder_interval_minutes: value });
  };

  const filteredItems = useMemo(() => {
    if (!regimens) return [];
    let list = regimens;
    if (statusFilter !== "all") {
      list = list.filter((r) => {
        const isOneOff = (r.schedule as { mode?: string })?.mode === "one_off";
        if (isOneOff) return statusFilter === "completed";
        return getEffectiveStatus(r) === statusFilter;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => r.custom_name.toLowerCase().includes(q));
    }
    const isCompletedOrOneOff = (r: (typeof list)[number]) =>
      getEffectiveStatus(r) === "completed" ||
      (r.schedule as { mode?: string })?.mode === "one_off";
    return [...list].sort((a, b) => {
      const aEnd = isCompletedOrOneOff(a) ? 1 : 0;
      const bEnd = isCompletedOrOneOff(b) ? 1 : 0;
      return aEnd - bEnd;
    });
  }, [regimens, statusFilter, searchQuery]);

  const hasActiveFilters = searchQuery || statusFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
  };

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold truncate min-w-0">{t("medications.navTitle")}</h1>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => allMedsRef.current?.scrollIntoView({ behavior: "smooth" })}
          >
            <List className="h-4 w-4" />
            {t("medications.allMedications")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            aria-label={t("medications.settings")}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                {t("medications.add")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="min-w-[10rem]">
              <DropdownMenuItem
                onClick={() => router.push("/health/medications/new?kind=one_time")}
              >
                {t("medications.oneTime")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/health/medications/new?kind=regular")}>
                {t("medications.regular")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <MedicationDashboard />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("medications.settings")}
            </DialogTitle>
            <DialogDescription>
              {t("medications.overdueReminderIntervalDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label htmlFor="overdue-interval-popup" className="text-sm font-medium block mb-2">
                {t("medications.overdueReminderInterval")}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="overdue-interval-popup"
                  type="number"
                  min={1}
                  max={1440}
                  value={overdueIntervalMinutes}
                  onChange={(e) => setOverdueIntervalMinutes(Number(e.target.value) || 30)}
                  onBlur={handleSaveOverdueInterval}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {t("medications.overdueReminderIntervalMinutes")}
                </span>
              </div>
            </div>
            <Button
              size="sm"
              onClick={async () => {
                await handleSaveOverdueInterval();
                setSettingsOpen(false);
              }}
              disabled={updatePreferences.isPending}
            >
              {updatePreferences.isPending ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Separator />

      <div ref={allMedsRef} className="scroll-mt-4 space-y-6">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("medications.allMedications")}
        </h2>

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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSearchQuery("")}
                className="tap-target absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder={t("medications.statusActive")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("medications.all")}</SelectItem>
              <SelectItem value="active">{t("medications.statusActive")}</SelectItem>
              <SelectItem value="paused">{t("medications.statusPaused")}</SelectItem>
              <SelectItem value="completed">{t("medications.statusCompleted")}</SelectItem>
              <SelectItem value="archived">{t("medications.statusArchived")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">{t("common.filter")}:</span>
            {searchQuery && (
              <span className="text-sm text-muted-foreground">&quot;{searchQuery}&quot;</span>
            )}
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 px-2 text-xs">
              {t("common.clear")}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : !regimens || regimens.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            <Pill className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="font-medium">{t("medications.noItems")}</p>
            <p className="text-sm mt-1">{t("medications.noItemsHint")}</p>
            <Link href="/health/medications/new">
              <Button size="sm" className="mt-3">
                {t("medications.add")}
              </Button>
            </Link>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            <p>{t("common.noResults")}</p>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2">
              {t("common.clear")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,360px))]">
            {filteredItems.map((r) => (
              <RegimenCard key={r.id} regimen={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
