"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Search, X, FileText, Plus } from "lucide-react";
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
} from "@/hooks";
import type { MedicalRecordListItem, RecordType, RecordStatus } from "@/types";
import { RECORD_TYPES } from "@/types";

interface RecordsListProps {
  personId: string;
  personName: string;
}

export function RecordsList({ personId, personName }: RecordsListProps) {
  const t = useTranslations();
  const router = useRouter();

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecordType | "all">("all");
  const [showRemoved, setShowRemoved] = useState(false);

  // Debounce search query (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Confirmation dialog state
  const [recordToRemove, setRecordToRemove] = useState<MedicalRecordListItem | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<MedicalRecordListItem | null>(null);

  // Mutations
  const softDeleteMutation = useSoftDeleteRecord();
  const restoreMutation = useRestoreRecord();
  const hardDeleteMutation = useHardDeleteRecord();

  // Build filters for the query (use debounced search)
  const filters = useMemo(
    () => ({
      person_id: personId,
      record_type: typeFilter === "all" ? undefined : typeFilter,
      status: showRemoved ? ("removed" as RecordStatus) : ("active" as RecordStatus),
      search: debouncedSearch.trim() || undefined,
    }),
    [personId, typeFilter, showRemoved, debouncedSearch]
  );

  const { data: records, isLoading, error } = useMedicalRecords(filters);

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

  const clearFilters = () => {
    setSearchQuery("");
    setTypeFilter("all");
    setShowRemoved(false);
  };

  const hasActiveFilters = searchQuery || typeFilter !== "all" || showRemoved;

  return (
    <div className="space-y-4">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("health.title")} — {personName}
          </h1>
          <p className="text-muted-foreground">{t("health.description")}</p>
        </div>
        <Button onClick={() => router.push("/health/records/new")}>
          <Plus className="mr-2 h-4 w-4" />
          {t("health.addRecord")}
        </Button>
      </div>

      {/* Search and filters */}
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

        <Button
          variant={showRemoved ? "secondary" : "outline"}
          onClick={() => setShowRemoved(!showRemoved)}
          className="shrink-0"
        >
          {t("records.showRemoved")}
        </Button>
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
          {showRemoved && (
            <Badge variant="secondary" className="gap-1">
              {t("records.showRemoved")}
              <button onClick={() => setShowRemoved(false)}>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              onView={handleView}
              onRemove={handleRemove}
              onRestore={showRemoved ? handleRestore : undefined}
              onDelete={showRemoved ? handleDelete : undefined}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && records && records.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">
            {hasActiveFilters ? t("common.noResults") : t("health.noRecords")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasActiveFilters
              ? t("common.noResults")
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
    </div>
  );
}
