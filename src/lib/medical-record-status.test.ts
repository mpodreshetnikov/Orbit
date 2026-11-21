import { describe, expect, it } from "vitest";
import {
  isStuckPendingOcrStatus,
  isUnprocessedRecordStatus,
  STUCK_PENDING_OCR_STATUSES,
  UNPROCESSED_RECORD_STATUSES,
} from "./medical-record-status";

describe("medical-record-status", () => {
  it("treats ocr_processing and legacy processing as stuck pending OCR", () => {
    expect(STUCK_PENDING_OCR_STATUSES).toEqual(["ocr_processing", "processing"]);
    expect(isStuckPendingOcrStatus("ocr_processing")).toBe(true);
    expect(isStuckPendingOcrStatus("processing")).toBe(true);
    expect(isStuckPendingOcrStatus("structuring")).toBe(false);
    expect(isStuckPendingOcrStatus("active")).toBe(false);
  });

  it("groups unprocessed UI-pipeline statuses for the list filter", () => {
    expect(UNPROCESSED_RECORD_STATUSES).toEqual([
      "ocr_processing",
      "structuring",
      "processing",
      "ocr_failed",
    ]);
    expect(isUnprocessedRecordStatus("ocr_failed")).toBe(true);
    expect(isUnprocessedRecordStatus("draft")).toBe(false);
  });
});
