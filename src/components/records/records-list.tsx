"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, FileText, Plus, FileStack, Loader2 } from "lucide-react";
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
import { RecordCard } from "./record-card";
import {
  useMedicalRecords,
  useSoftDeleteRecord,
  useRestoreRecord,
  useHardDeleteRecord,
  useUpdateMedicalRecord,
  useProcessingMonitor,
} from "@/hooks";
import type { MedicalRecordListItem, RecordType, RecordStatus } from "@/types";
import { RECORD_TYPES } from "@/types";
import { cn } from "@/lib/utils";

type StatusFilter = "active" | "draft" | "processing" | "removed";

interface RecordsListProps {
  personId: string;
  personName: string;
}

export function RecordsList({ personId, personName }: RecordsListProps) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Monitor for completed processing jobs and show notifications
  useProcessingMonitor(personId);

  // Check if we should show drafts from URL param
  const showDraftsFromUrl = searchParams.get("showDrafts") === "true";

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecordType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    showDraftsFromUrl ? "draft" : "active"
  );

  // Debounce search query (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Update status filter if URL param changes
  useEffect(() => {
    if (showDraftsFromUrl && statusFilter === "active") {
      setStatusFilter("draft");
    }
  }, [showDraftsFromUrl, statusFilter]);

  // Confirmation dialog state
  const [recordToRemove, setRecordToRemove] = useState<MedicalRecordListItem | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<MedicalRecordListItem | null>(null);
  const [recordToActivate, setRecordToActivate] = useState<MedicalRecordListItem | null>(null);

  // Mutations
  const softDeleteMutation = useSoftDeleteRecord();
  const restoreMutation = useRestoreRecord();
  const hardDeleteMutation = useHardDeleteRecord();
  const updateMutation = useUpdateMedicalRecord();


  // Build filters for the query (use debounced search)
  const filters = useMemo(
    () => ({
      person_id: personId,
      record_type: typeFilter === "all" ? undefined : typeFilter,
      status: statusFilter as RecordStatus,
      search: debouncedSearch.trim() || undefined,
    }),
    [personId, typeFilter, statusFilter, debouncedSearch]
  );

  const { data: records, isLoading, error } = useMedicalRecords(filters);

  // Also fetch drafts count for badge (when viewing active)
  const draftsFilters = useMemo(
    () => ({
      person_id: personId,
      status: "draft" as RecordStatus,
    }),
    [personId]
  );
  const { data: drafts } = useMedicalRecords(
    statusFilter !== "draft" ? draftsFilters : { person_id: "" }
  );

  // Also fetch processing count for badge
  const processingFilters = useMemo(
    () => ({
      person_id: personId,
      status: "processing" as RecordStatus,
    }),
    [personId]
  );
  const { data: processingRecords } = useMedicalRecords(
    statusFilter !== "processing" ? processingFilters : { person_id: "" }
  );

  const draftsCount = drafts?.length || 0;
  // Only count DB records with "processing" status - don't double count with store jobs
  // since jobs in "processing" stage correspond to DB records with status "processing"
  const processingCount = processingRecords?.length || 0;

  const handleView = (record: MedicalRecordListItem) => {
    router.push(`/health/records/${record.id}`);
  };

  const handleRemove = (record: MedicalRecordListItem) => {
    setRecordToRemove(record);
  };

  const handleRestore = (record: MedicalRecordListItem) => {
    restoreMutation.mutate(record.id);
  };

  const handleDelete = (record: MedicalRecordListItem) => {
    setRecordToDelete(record);
  };

  const handleActivate = (record: MedicalRecordListItem) => {
    setRecordToActivate(record);
  };

  const confirmRemove = () => {
    if (recordToRemove) {
      softDeleteMutation.mutate(recordToRemove.id);
      setRecordToRemove(null);
    }
  };

  const confirmDelete = () => {
    if (recordToDelete) {
      hardDeleteMutation.mutate(recordToDelete.id);
      setRecordToDelete(null);
    }
  };

  const confirmActivate = () => {
    if (recordToActivate) {
      updateMutation.mutate({
        id: recordToActivate.id,
        updates: { status: "active" },
      });
      setRecordToActivate(null);
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setTypeFilter("all");
    setStatusFilter("active");
    // Clear URL param
    router.replace("/health");
  };

  const hasActiveFilters = searchQuery || typeFilter !== "all" || statusFilter !== "active";

  return (
    <div className="space-y-4 min-w-0 overflow-x-hidden">
      {/* Header with Add button */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight truncate min-w-0">
          {t("health.title")} — {personName}
        </h1>
        <Button onClick={() => router.push("/health/records/new")} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          {t("health.addRecord")}
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto">
        <Button
          variant={statusFilter === "active" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusFilter("active")}
          className="shrink-0"
        >
          {t("records.statusFilter.active")}
        </Button>
        <Button
          variant={statusFilter === "draft" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusFilter("draft")}
          className={cn("shrink-0 gap-1", draftsCount > 0 && statusFilter !== "draft" && "text-primary")}
        >
          <FileStack className="h-4 w-4" />
          {t("records.statusFilter.drafts")}
          {draftsCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {draftsCount}
            </Badge>
          )}
        </Button>
        <Button
          variant={statusFilter === "processing" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusFilter("processing")}
          className={cn("shrink-0 gap-1", processingCount > 0 && statusFilter !== "processing" && "text-primary")}
        >
          <Loader2 className={cn("h-4 w-4", processingCount > 0 && "animate-spin")} />
          {t("records.statusFilter.processing")}
          {processingCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {processingCount}
            </Badge>
          )}
        </Button>
        <Button
          variant={statusFilter === "removed" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setStatusFilter("removed")}
          className="shrink-0"
        >
          {t("records.statusFilter.removed")}
        </Button>
      </div>

      {/* Search and type filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("records.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
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

      {/* Active filters display */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">{t("common.filter")}:</span>
          {searchQuery && (
            <Badge variant="secondary" className="gap-1">
              {searchQuery}
              <button onClick={() => setSearchQuery("")}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {typeFilter !== "all" && (
            <Badge variant="secondary" className="gap-1">
              {t(`records.types.${typeFilter}`)}
              <button onClick={() => setTypeFilter("all")}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {statusFilter !== "active" && (
            <Badge variant="secondary" className="gap-1">
              {t(`records.statusFilter.${statusFilter}`)}
              <button onClick={() => setStatusFilter("active")}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("common.clear")}
          </Button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32 min-w-0" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
          <p className="text-destructive">{t("common.error")}</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      )}

      {/* Records grid */}
      {!isLoading && !error && records && records.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
          {records.map((record) => (
            <div key={record.id} className="min-w-0">
            <RecordCard
              key={record.id}
              record={record}
              onView={handleView}
              onRemove={handleRemove}
              onRestore={statusFilter === "removed" ? handleRestore : undefined}
              onDelete={statusFilter === "removed" ? handleDelete : undefined}
              onActivate={statusFilter === "draft" ? handleActivate : undefined}
            />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && records && records.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          {statusFilter === "draft" ? (
            <FileStack className="h-12 w-12 text-muted-foreground/50" />
          ) : statusFilter === "processing" ? (
            <Loader2 className="h-12 w-12 text-muted-foreground/50" />
          ) : (
            <FileText className="h-12 w-12 text-muted-foreground/50" />
          )}
          <h3 className="mt-4 text-lg font-semibold">
            {hasActiveFilters 
              ? statusFilter === "draft" 
                ? t("records.noDrafts") 
                : statusFilter === "processing"
                  ? t("records.noProcessing")
                  : t("common.noResults")
              : t("health.noRecords")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasActiveFilters
              ? statusFilter === "draft"
                ? t("records.noDraftsDescription")
                : statusFilter === "processing"
                  ? t("records.noProcessingDescription")
                  : t("common.noResults")
              : t("health.noRecordsDescription")}
          </p>
          {!hasActiveFilters && (
            <Button
              className="mt-4"
              onClick={() => router.push("/health/records/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("health.addRecord")}
            </Button>
          )}
          {statusFilter === "draft" && (
            <Button
              className="mt-4"
              onClick={() => router.push("/health/records/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("health.addRecord")}
            </Button>
          )}
        </div>
      )}

      {/* Remove confirmation dialog */}
      <AlertDialog
        open={!!recordToRemove}
        onOpenChange={(open) => !open && setRecordToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.confirm.removeMessage")}
            </AlertDialogDescription>
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

      {/* Delete permanently confirmation dialog */}
      <AlertDialog
        open={!!recordToDelete}
        onOpenChange={(open) => !open && setRecordToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.confirm.deleteMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activate draft confirmation dialog */}
      <AlertDialog
        open={!!recordToActivate}
        onOpenChange={(open) => !open && setRecordToActivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.activateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.confirm.activateMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmActivate}>
              {t("records.actions.activate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
