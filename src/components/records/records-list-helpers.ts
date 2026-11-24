import type { RecordType } from "@/types";

export type StatusFilter = "active" | "draft" | "processing" | "removed";

export const TAB_VALUES: readonly StatusFilter[] = ["active", "draft", "processing", "removed"];

export function tabFromSearchParams(searchParams: URLSearchParams): StatusFilter {
  const tab = searchParams.get("tab");
  const knownTab = TAB_VALUES.find((value) => value === tab);
  if (knownTab) {
    return knownTab;
  }
  if (searchParams.get("showDrafts") === "true") {
    return "draft";
  }
  return "active";
}

export function countOrZero(items: { length: number } | null | undefined): number {
  if (items == null) {
    return 0;
  }
  return items.length;
}

export function hasActiveFilters(
  searchQuery: string,
  typeFilter: RecordType | "all",
  statusFilter: StatusFilter,
): boolean {
  if (searchQuery.length > 0) {
    return true;
  }
  if (typeFilter !== "all") {
    return true;
  }
  return statusFilter !== "active";
}

export function emptyStateCopy(statusFilter: StatusFilter, filtersActive: boolean) {
  if (!filtersActive) {
    return { title: "health.noRecords", body: "health.noRecordsViaAssistant" };
  }
  if (statusFilter === "draft") {
    return { title: "records.noDrafts", body: "records.noDraftsDescription" };
  }
  if (statusFilter === "processing") {
    return { title: "records.noNotProcessed", body: "records.noNotProcessedDescription" };
  }
  return { title: "common.noResults", body: "common.noResults" };
}

export function recordTypeFilterParam(typeFilter: RecordType | "all"): RecordType | undefined {
  if (typeFilter === "all") {
    return undefined;
  }
  return typeFilter;
}

export function searchFilterParam(debouncedSearch: string): string | undefined {
  const trimmed = debouncedSearch.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

export function sideFilterPersonId(
  statusFilter: StatusFilter,
  tab: StatusFilter,
  personId: string,
): string {
  if (statusFilter === tab) {
    return "";
  }
  return personId;
}
