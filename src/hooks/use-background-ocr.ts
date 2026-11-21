"use client";

/**
 * Stub: UI OCR upload/retry was removed (ingest via MCP only).
 * Kept so legacy record-detail can import without pulling the old client OCR path.
 * The detail gate never routes ocr_failed/stuck statuses into that UI.
 */

export interface RetryOCRInput {
  recordId: string;
  personId: string;
  personName: string;
}

export function useBackgroundOCR() {
  return {
    retryOcr: async (_input: RetryOCRInput): Promise<void> => {
      throw new Error("UI OCR retry is disabled; ingest via assistant");
    },
  };
}
