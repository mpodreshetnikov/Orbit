import { describe, expect, it } from "vitest";
import { useBackgroundOCR } from "./use-background-ocr";

describe("useBackgroundOCR stub", () => {
  it("rejects retry because UI OCR is disabled", async () => {
    const { retryOcr } = useBackgroundOCR();
    await expect(retryOcr({ recordId: "r1", personId: "p1", personName: "Ada" })).rejects.toThrow(
      /UI OCR retry is disabled/,
    );
  });
});
