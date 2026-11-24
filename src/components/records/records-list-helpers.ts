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

export function tabButtonVariant(selected: boolean): "secondary" | "ghost" {
  return selected ? "secondary" : "ghost";
}

/** Accent when the tab has items and is not the selected tab. */
export function tabNeedsAccent(count: number, selected: boolean): boolean {
  return count > 0 && !selected;
}

export function showCountBadge(count: number): boolean {
  return count > 0;
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

export function emptyTitleKey(statusFilter: StatusFilter, filtersActive: boolean): string {
  if (!filtersActive) {
    return "health.noRecords";
  }
  if (statusFilter === "draft") {
    return "records.noDrafts";
  }
  if (statusFilter === "processing") {
    return "records.noNotProcessed";
  }
  return "common.noResults";
}

export function emptyBodyKey(statusFilter: StatusFilter, filtersActive: boolean): string {
  if (!filtersActive) {
    return "health.noRecordsViaAssistant";
  }
  if (statusFilter === "draft") {
    return "records.noDraftsDescription";
  }
  if (statusFilter === "processing") {
    return "records.noNotProcessedDescription";
  }
  return "common.noResults";
}

export function emptyIconKind(statusFilter: StatusFilter): "draft" | "notProcessed" | "default" {
  if (statusFilter === "draft") {
    return "draft";
  }
  if (statusFilter === "processing") {
    return "notProcessed";
  }
  return "default";
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
