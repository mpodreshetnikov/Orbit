import type { RecordStatus } from "@/types";

/**
 * Statuses left behind by the removed UI OCR pipeline. Records stay in the DB;
 * the UI must not show an eternal "processing" spinner for them.
 */
export const STUCK_PENDING_OCR_STATUSES: readonly RecordStatus[] = ["ocr_processing", "processing"];

/** In-flight or failed UI-pipeline statuses shown under the "not processed" filter. */
export const UNPROCESSED_RECORD_STATUSES: readonly RecordStatus[] = [
  "ocr_processing",
  "structuring",
  "processing",
  "ocr_failed",
];

export function isStuckPendingOcrStatus(status: string): boolean {
  return (STUCK_PENDING_OCR_STATUSES as readonly string[]).includes(status);
}

export function isUnprocessedRecordStatus(status: string): boolean {
  return (UNPROCESSED_RECORD_STATUSES as readonly string[]).includes(status);
}

/** Detail gate: stuck OCR, mid-structuring, or failed OCR — no in-app retry/upload. */
export function isUnprocessedPipelineStatus(status: string): boolean {
  return isUnprocessedRecordStatus(status);
}

/** Soft-remove stays for ocr_failed; hide while still mid-pipeline. */
export function shouldHideSoftRemove(status: string): boolean {
  return isStuckPendingOcrStatus(status) || status === "structuring";
}
