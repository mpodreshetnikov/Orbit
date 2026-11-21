import { describe, expect, it } from "vitest";
import {
  isStuckPendingOcrStatus,
  isUnprocessedPipelineStatus,
  isUnprocessedRecordStatus,
  shouldHideSoftRemove,
  STUCK_PENDING_OCR_STATUSES,
  UNPROCESSED_RECORD_STATUSES,
} from "./medical-record-status";

describe("medical-record-status", () => {
  it("treats ocr_processing and legacy processing as stuck pending OCR", () => {
    expect(STUCK_PENDING_OCR_STATUSES).toEqual(["ocr_processing", "processing"]);
    expect(STUCK_PENDING_OCR_STATUSES).toHaveLength(2);
    expect(STUCK_PENDING_OCR_STATUSES[0]).toBe("ocr_processing");
    expect(STUCK_PENDING_OCR_STATUSES[1]).toBe("processing");
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
    expect(UNPROCESSED_RECORD_STATUSES).toHaveLength(4);
    expect(isUnprocessedRecordStatus("ocr_failed")).toBe(true);
    expect(isUnprocessedRecordStatus("draft")).toBe(false);
    expect(isUnprocessedPipelineStatus("structuring")).toBe(true);
    expect(isUnprocessedPipelineStatus("active")).toBe(false);
  });

  it("hides soft-remove while OCR is still mid-pipeline", () => {
    expect(shouldHideSoftRemove("ocr_processing")).toBe(true);
    expect(shouldHideSoftRemove("processing")).toBe(true);
    expect(shouldHideSoftRemove("structuring")).toBe(true);
    expect(shouldHideSoftRemove("ocr_failed")).toBe(false);
    expect(shouldHideSoftRemove("active")).toBe(false);
  });
});
