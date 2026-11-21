"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleSlash, FileStack, FileText, Search, X } from "lucide-react";
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
  countOrZero,
  emptyBodyKey,
  emptyIconKind,
  emptyTitleKey,
  hasActiveFilters,
  recordTypeFilterParam,
  searchFilterParam,
  showCountBadge,
  sideFilterPersonId,
  tabButtonVariant,
  tabFromSearchParams,
  tabNeedsAccent,
  type StatusFilter,
} from "./records-list-helpers";

interface RecordsListProps {
  personId: string;
  personName: string;
}

/**
 * Records list without in-app medical upload (Decision B / MCP-only ingest).
 */
export function RecordsList({ personId, personName }: RecordsListProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusFilter = tabFromSearchParams(searchParams);

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

  const filters = useMemo(
    () => ({
      person_id: personId,
      record_type: recordTypeFilterParam(typeFilter),
      status: statusFilter as never,
      search: searchFilterParam(debouncedSearch),
    }),
    [personId, typeFilter, statusFilter, debouncedSearch],
  );

  const draftsFilters = useMemo(
    () => ({
      person_id: sideFilterPersonId(statusFilter, "draft", personId),
      status: "draft" as never,
    }),
    [personId, statusFilter],
  );
  const processingFilters = useMemo(
    () => ({
      person_id: sideFilterPersonId(statusFilter, "processing", personId),
      status: "processing" as never,
    }),
    [personId, statusFilter],
  );

  const { data: records, isLoading, error } = useMedicalRecords(filters);
  const { data: drafts } = useMedicalRecords(draftsFilters);
  const { data: processingRecords } = useMedicalRecords(processingFilters);
  const draftsCount = countOrZero(drafts);
  const processingCount = countOrZero(processingRecords);
  const filtersActive = hasActiveFilters(searchQuery, typeFilter, statusFilter);

  const confirmRemove = () => {
    if (recordToRemove === null) {
      return;
    }
    softDeleteMutation.mutate(recordToRemove.id);
    setRecordToRemove(null);
  };

  const iconKind = emptyIconKind(statusFilter);

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden">
      <h1 className="text-2xl font-bold tracking-tight truncate min-w-0">
        {t("health.title")} — {personName}
      </h1>

      <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto">
        <Button
          variant={tabButtonVariant(statusFilter === "active")}
          size="sm"
          onClick={() => setTabInUrl("active")}
          className="shrink-0"
        >
          {t("records.statusFilter.active")}
        </Button>
        <Button
          variant={tabButtonVariant(statusFilter === "draft")}
          size="sm"
          onClick={() => setTabInUrl("draft")}
          className={cn(
            "shrink-0 gap-1",
            tabNeedsAccent(draftsCount, statusFilter === "draft") && "text-primary",
          )}
        >
          <FileStack className="h-4 w-4" />
          {t("records.statusFilter.drafts")}
          {showCountBadge(draftsCount) ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {draftsCount}
            </Badge>
          ) : null}
        </Button>
        <Button
          variant={tabButtonVariant(statusFilter === "processing")}
          size="sm"
          onClick={() => setTabInUrl("processing")}
          className={cn(
            "shrink-0 gap-1",
            tabNeedsAccent(processingCount, statusFilter === "processing") && "text-primary",
          )}
        >
          <CircleSlash className="h-4 w-4" />
          {t("records.statusFilter.notProcessed")}
          {showCountBadge(processingCount) ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {processingCount}
            </Badge>
          ) : null}
        </Button>
        <Button
          variant={tabButtonVariant(statusFilter === "removed")}
          size="sm"
          onClick={() => setTabInUrl("removed")}
          className="shrink-0"
        >
          {t("records.statusFilter.removed")}
        </Button>
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

      {!isLoading && error === null && records !== undefined && records.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
          {records.map((record) => (
            <div key={record.id} className="min-w-0">
              <RecordCard
                record={record}
                onView={(item) => router.push(`/health/records/${item.id}`)}
                onRemove={setRecordToRemove}
                onRestore={
                  statusFilter === "removed" ? (item) => restoreMutation.mutate(item.id) : undefined
                }
                onDelete={
                  statusFilter === "removed"
                    ? (item) => hardDeleteMutation.mutate(item.id)
                    : undefined
                }
                onActivate={
                  statusFilter === "draft"
                    ? (item) =>
                        updateMutation.mutate({ id: item.id, updates: { status: "active" } })
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      {!isLoading && error === null && records !== undefined && records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          {iconKind === "draft" ? (
            <FileStack className="h-12 w-12 text-muted-foreground/50" />
          ) : null}
          {iconKind === "notProcessed" ? (
            <CircleSlash className="h-12 w-12 text-muted-foreground/50" />
          ) : null}
          {iconKind === "default" ? (
            <FileText className="h-12 w-12 text-muted-foreground/50" />
          ) : null}
          <h3 className="mt-4 text-lg font-semibold">
            {t(emptyTitleKey(statusFilter, filtersActive))}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(emptyBodyKey(statusFilter, filtersActive))}
          </p>
        </div>
      ) : null}

      <AlertDialog
        open={recordToRemove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecordToRemove(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("records.confirm.removeMessage")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
