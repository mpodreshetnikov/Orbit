"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleSlash, FileStack, FileText, Search, X, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RecordCard } from "./record-card-view";
import {
  useHardDeleteRecord,
  useMedicalRecords,
  useRestoreRecord,
  useSoftDeleteRecord,
  useUpdateMedicalRecord,
} from "@/hooks";
import type { MedicalRecordListItem, RecordType } from "@/types";
import { RECORD_TYPES } from "@/types";
import { cn } from "@/lib/utils";
import {
  TAB_VALUES,
  countOrZero,
  emptyStateCopy,
  hasActiveFilters,
  recordTypeFilterParam,
  searchFilterParam,
  sideFilterPersonId,
  tabFromSearchParams,
  type StatusFilter,
} from "./records-list-helpers";

interface RecordsListProps {
  personId: string;
  personName: string;
}

const TABS: Record<StatusFilter, { label: string; icon?: LucideIcon }> = {
  active: { label: "records.statusFilter.active" },
  draft: { label: "records.statusFilter.drafts", icon: FileStack },
  processing: { label: "records.statusFilter.notProcessed", icon: CircleSlash },
  removed: { label: "records.statusFilter.removed" },
};

export function RecordsList({ personId, personName }: RecordsListProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusFilter = tabFromSearchParams(searchParams);
  const isDraftTab = statusFilter === "draft";
  const isRemovedTab = statusFilter === "removed";

  const setTabInUrl = (tab: StatusFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "active") {
      params.delete("tab");
      params.delete("showDrafts");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecordType | "all">("all");
  const [recordToRemove, setRecordToRemove] = useState<MedicalRecordListItem | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const softDeleteMutation = useSoftDeleteRecord();
  const restoreMutation = useRestoreRecord();
  const hardDeleteMutation = useHardDeleteRecord();
  const updateMutation = useUpdateMedicalRecord();

  const {
    data: records,
    isLoading,
    error,
  } = useMedicalRecords({
    person_id: personId,
    record_type: recordTypeFilterParam(typeFilter),
    status: statusFilter,
    search: searchFilterParam(debouncedSearch),
  });
  const { data: drafts } = useMedicalRecords({
    person_id: sideFilterPersonId(statusFilter, "draft", personId),
    status: "draft",
  });
  const { data: processingRecords } = useMedicalRecords({
    person_id: sideFilterPersonId(statusFilter, "processing", personId),
    status: "processing",
  });
  const tabCounts = {
    active: 0,
    draft: countOrZero(drafts),
    processing: countOrZero(processingRecords),
    removed: 0,
  };
  const filtersActive = hasActiveFilters(searchQuery, typeFilter, statusFilter);
  const emptyCopy = emptyStateCopy(statusFilter, filtersActive);
  const EmptyIcon = TABS[statusFilter].icon ?? FileText;
  const hasLoadedRecords = !isLoading && error === null && records !== undefined;

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden">
      <h1 className="text-2xl font-bold tracking-tight truncate min-w-0">
        {t("health.title")} — {personName}
      </h1>

      <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto">
        {TAB_VALUES.map((tab) => {
          const { label, icon: Icon } = TABS[tab];
          const selected = statusFilter === tab;
          const count = tabCounts[tab];
          const showCount = count > 0;
          return (
            <Button
              key={tab}
              variant={selected ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTabInUrl(tab)}
              className={cn("shrink-0", Icon && "gap-1", showCount && !selected && "text-primary")}
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              {t(label)}
              {showCount ? (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {count}
                </Badge>
              ) : null}
            </Button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("records.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
          {searchQuery.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("records.clearSearch")}
              onClick={() => setSearchQuery("")}
              className="tap-target absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <Select
          value={typeFilter}
          onValueChange={(value) => setTypeFilter(value as RecordType | "all")}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t("records.filterByType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("records.allTypes")}</SelectItem>
            {RECORD_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`records.types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtersActive ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearchQuery("");
            setTypeFilter("all");
            router.replace(pathname);
          }}
        >
          {t("common.clear")}
        </Button>
      ) : null}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 min-w-0" />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
          <p className="text-destructive">{t("common.error")}</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      ) : null}

      {hasLoadedRecords && records.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
          {records.map((record) => (
            <li key={record.id} className="min-w-0">
              <RecordCard
                record={record}
                onView={(item) => router.push(`/health/records/${item.id}`)}
                onRemove={setRecordToRemove}
                {...(isRemovedTab
                  ? {
                      onRestore: (item: MedicalRecordListItem) => restoreMutation.mutate(item.id),
                      onDelete: (item: MedicalRecordListItem) => hardDeleteMutation.mutate(item.id),
                    }
                  : undefined)}
                onActivate={
                  isDraftTab
                    ? (item) =>
                        updateMutation.mutate({ id: item.id, updates: { status: "active" } })
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      ) : null}

      {hasLoadedRecords && records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <EmptyIcon className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">{t(emptyCopy.title)}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t(emptyCopy.body)}</p>
        </div>
      ) : null}

      {recordToRemove && (
        <AlertDialog open onOpenChange={() => setRecordToRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("records.confirm.removeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("records.confirm.removeMessage")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => softDeleteMutation.mutate(recordToRemove.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("common.remove")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
