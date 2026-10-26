import type { MoneyImportBatch, MoneyImportBatchStatus } from "./import";

/**
 * Reconciling imports: every batch now lands without anyone confirming it (T-261026-2ew), so the
 * owner checks them afterwards, over the last week, the last month, or days of his choosing.
 * Shared by the web history page and the iOS history screen.
 */
export type ImportReviewPeriod = "week" | "month" | "custom" | "all";

export const IMPORT_REVIEW_PERIODS: readonly ImportReviewPeriod[] = [
  "week",
  "month",
  "custom",
  "all",
];

export interface ImportReviewWindow {
  from: Date | null;
  to: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` as typed in a date input, read as that whole local day. */
function parseDay(value: string | null | undefined, boundary: "start" | "end"): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return boundary === "start"
    ? new Date(year, month - 1, day, 0, 0, 0, 0)
    : new Date(year, month - 1, day, 23, 59, 59, 999);
}

/**
 * The window a period covers. A week and a month are the last 7 and 30 days, the same spans the
 * transaction feed's 7d and 30d presets use, so the feed link shows the operations of that window.
 */
export function importReviewWindow(
  period: ImportReviewPeriod,
  now: Date,
  custom: { from?: string | null; to?: string | null } = {},
): ImportReviewWindow {
  if (period === "week") return { from: new Date(now.getTime() - 7 * DAY_MS), to: now };
  if (period === "month") return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
  if (period === "custom") {
    return { from: parseDay(custom.from, "start"), to: parseDay(custom.to, "end") };
  }
  return { from: null, to: null };
}

type ReviewedBatch = Pick<
  MoneyImportBatch,
  "created_at" | "status" | "inserted_count" | "skipped_count" | "error_count"
>;

/** Batches started inside the window, by when the import ran rather than what it covered. */
export function batchesInWindow<T extends Pick<MoneyImportBatch, "created_at">>(
  batches: readonly T[],
  window: ImportReviewWindow,
): T[] {
  return batches.filter((batch) => {
    const createdAt = new Date(batch.created_at).getTime();
    if (!Number.isFinite(createdAt)) return false;
    if (window.from && createdAt < window.from.getTime()) return false;
    if (window.to && createdAt > window.to.getTime()) return false;
    return true;
  });
}

export interface ImportReviewSummary {
  imports: number;
  inserted: number;
  skipped: number;
  errors: number;
  failed: number;
  rolledBack: number;
}

/** What the period added. A rolled back batch counts as rolled back, not as what it once added. */
export function summarizeImportBatches(batches: readonly ReviewedBatch[]): ImportReviewSummary {
  const summary: ImportReviewSummary = {
    imports: batches.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
    failed: 0,
    rolledBack: 0,
  };
  for (const batch of batches) {
    if (batch.status === "rolled_back") {
      summary.rolledBack += 1;
      continue;
    }
    if (batch.status === "failed") summary.failed += 1;
    if (batch.status !== "completed") continue;
    summary.inserted += batch.inserted_count ?? 0;
    summary.skipped += batch.skipped_count ?? 0;
    summary.errors += batch.error_count ?? 0;
  }
  return summary;
}

/** The transaction feed's query for the same window, so the period's operations are one tap away. */
export function feedQueryForReviewPeriod(
  period: ImportReviewPeriod,
  custom: { from?: string | null; to?: string | null } = {},
): string | null {
  if (period === "week") return "preset=7d";
  if (period === "month") return "preset=30d";
  if (period === "custom") {
    if (!parseDay(custom.from, "start") || !parseDay(custom.to, "end")) return null;
    return `preset=custom&from=${custom.from}&to=${custom.to}`;
  }
  return null;
}

/** What an import's page leads with: still reading, landed, undone, or broken. */
export type ImportOutcome =
  | "running"
  | "applied"
  | "awaiting"
  | "rolled_back"
  | "failed"
  | "discarded";

export function importOutcome(status: MoneyImportBatchStatus): ImportOutcome {
  if (status === "running") return "running";
  if (status === "completed") return "applied";
  if (status === "rolled_back") return "rolled_back";
  if (status === "failed") return "failed";
  if (status === "discarded") return "discarded";
  return "awaiting";
}
