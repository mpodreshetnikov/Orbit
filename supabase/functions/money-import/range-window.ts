import { toIsoOrNull } from "./normalize.ts";
import type { RangeSelectionMeta } from "./types.ts";

export const IMPORT_HISTORY_STALE_THRESHOLD_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export interface ImportContextResult {
  last_imported_at: string | null;
  requires_history_prompt: boolean;
  stale_threshold_days: number;
  recommended_mode: "auto" | "preset";
  window_from: string | null;
  window_to: string | null;
}

export interface EffectiveImportWindow {
  windowFrom: string | null;
  windowTo: string | null;
}

export interface RangeCounters {
  parsedRowCount: number;
  inRangeRowCount: number;
  filteredOutOfRangeCount: number;
  filteredInvalidDateCount: number;
}

export type RangeDecision =
  | { kind: "in_range"; postedAt: string }
  | { kind: "out_of_range"; postedAt: string; message: "Outside selected import range" }
  | { kind: "invalid_date"; message: "Invalid posted_at for selected import range" };

export function buildImportContext(lastImportedAt: string | null, now: Date): ImportContextResult {
  const windowTo = now.toISOString();
  const staleCutoffMs = now.getTime() - IMPORT_HISTORY_STALE_THRESHOLD_DAYS * DAY_MS;
  const lastImportedMs = lastImportedAt ? new Date(lastImportedAt).getTime() : Number.NaN;
  const hasRecentImport = Number.isFinite(lastImportedMs) && lastImportedMs >= staleCutoffMs;

  if (hasRecentImport && lastImportedAt) {
    return {
      last_imported_at: lastImportedAt,
      requires_history_prompt: false,
      stale_threshold_days: IMPORT_HISTORY_STALE_THRESHOLD_DAYS,
      recommended_mode: "auto",
      window_from: lastImportedAt,
      window_to: windowTo,
    };
  }

  return {
    last_imported_at: lastImportedAt,
    requires_history_prompt: true,
    stale_threshold_days: IMPORT_HISTORY_STALE_THRESHOLD_DAYS,
    recommended_mode: "preset",
    window_from: new Date(
      now.getTime() - IMPORT_HISTORY_STALE_THRESHOLD_DAYS * DAY_MS,
    ).toISOString(),
    window_to: windowTo,
  };
}

export function resolveEffectiveImportWindow(
  preferredFrom: unknown,
  preferredTo: unknown,
  fallbackFrom?: unknown,
  fallbackTo?: unknown,
): EffectiveImportWindow {
  return {
    windowFrom: toIsoOrNull(preferredFrom) ?? toIsoOrNull(fallbackFrom),
    windowTo: toIsoOrNull(preferredTo) ?? toIsoOrNull(fallbackTo),
  };
}

export function classifyRowForWindow(
  postedAtInput: unknown,
  windowFrom: string | null,
  windowTo: string | null,
): RangeDecision {
  const postedAt = toIsoOrNull(postedAtInput);
  if (!postedAt) {
    return {
      kind: "invalid_date",
      message: "Invalid posted_at for selected import range",
    };
  }
  if ((windowFrom && postedAt < windowFrom) || (windowTo && postedAt > windowTo)) {
    return {
      kind: "out_of_range",
      postedAt,
      message: "Outside selected import range",
    };
  }
  return {
    kind: "in_range",
    postedAt,
  };
}

export function mergeRangeMeta(
  existingMetaInput: unknown,
  incomingMetaInput: unknown,
  counters: RangeCounters,
): Record<string, unknown> {
  const existingMeta = asRecord(existingMetaInput) ?? {};
  const incomingMeta = asRecord(incomingMetaInput) ?? {};
  const merged = {
    ...existingMeta,
    ...incomingMeta,
  };

  const existingParsed = Number(asRecord(existingMeta)?.parsed_row_count ?? 0) || 0;
  const existingInRange = Number(asRecord(existingMeta)?.in_range_row_count ?? 0) || 0;
  const existingOutOfRange = Number(asRecord(existingMeta)?.filtered_out_of_range_count ?? 0) || 0;
  const existingInvalidDate = Number(asRecord(existingMeta)?.filtered_invalid_date_count ?? 0) || 0;

  merged.parsed_row_count = existingParsed + counters.parsedRowCount;
  merged.in_range_row_count = existingInRange + counters.inRangeRowCount;
  merged.filtered_out_of_range_count = existingOutOfRange + counters.filteredOutOfRangeCount;
  merged.filtered_invalid_date_count = existingInvalidDate + counters.filteredInvalidDateCount;

  const incomingRangeSelectionMeta =
    (asRecord(incomingMeta)?.range_selection_meta as Record<string, unknown> | undefined) ?? null;
  const existingRangeSelectionMeta =
    (asRecord(existingMeta)?.range_selection_meta as Record<string, unknown> | undefined) ?? null;
  merged.range_selection_meta = incomingRangeSelectionMeta ?? existingRangeSelectionMeta ?? null;

  return merged;
}

export function readRangeSelectionMeta(value: unknown): RangeSelectionMeta | null {
  const record = asRecord(value);
  if (!record) return null;
  const selectionMode =
    record.selection_mode === "auto" ||
    record.selection_mode === "preset" ||
    record.selection_mode === "custom"
      ? record.selection_mode
      : null;
  if (!selectionMode) return null;

  const presetKey =
    record.preset_key === "1m" ||
    record.preset_key === "3m" ||
    record.preset_key === "6m" ||
    record.preset_key === "1y" ||
    record.preset_key === "since_last_import"
      ? record.preset_key
      : null;

  return {
    selection_mode: selectionMode,
    preset_key: presetKey,
    prompted_for_history: Boolean(record.prompted_for_history),
    last_imported_at_at_decision_time: toIsoOrNull(record.last_imported_at_at_decision_time),
    stale_threshold_days: Number(
      record.stale_threshold_days ?? IMPORT_HISTORY_STALE_THRESHOLD_DAYS,
    ),
  };
}
