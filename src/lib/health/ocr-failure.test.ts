import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_OCR_CAUSES,
  formatClientOcrFailure,
  MAX_OCR_ERROR_LENGTH,
  parseOcrFailureCause,
  SERVER_OCR_CAUSES,
  translateOcrFailure,
} from "./ocr-failure";

const SERVER_FILE = join(process.cwd(), "supabase/functions/health-ocr/failure.ts");

describe("the two halves of the OCR failure vocabulary", () => {
  // The edge function is Deno and is deployed from its own directory, so neither side can import
  // the other. A code the server writes and this side does not know renders as raw English, which
  // is the defect this whole vocabulary exists to remove -- so the drift is caught here instead.
  it("declares the same server causes on both sides", () => {
    const source = readFileSync(SERVER_FILE, "utf8");
    const union = source.slice(
      source.indexOf("export type OcrFailureCause ="),
      source.indexOf('| "internal";') + '| "internal";'.length,
    );
    const declared = [...union.matchAll(/\|\s*"([a-z_]+)"/g)].map((match) => match[1]);

    expect(declared).toEqual([...SERVER_OCR_CAUSES]);
  });

  it("has a translation for every cause either side can write", () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), "src/messages/en.json"), "utf8"));
    const ru = JSON.parse(readFileSync(join(process.cwd(), "src/messages/ru.json"), "utf8"));

    for (const cause of [...SERVER_OCR_CAUSES, ...CLIENT_OCR_CAUSES]) {
      expect(en.processing.ocrCause[cause], `en: ${cause}`).toBeTruthy();
      expect(ru.processing.ocrCause[cause], `ru: ${cause}`).toBeTruthy();
    }
  });
});

describe("parseOcrFailureCause", () => {
  it("reads the cause the server wrote", () => {
    expect(
      parseOcrFailureCause(
        "ocr_cause:provider_auth the transcription service rejected this deployment's credentials",
      ),
    ).toBe("provider_auth");
  });

  it("reads a cause with no detail after it", () => {
    expect(parseOcrFailureCause("ocr_cause:no_attachments")).toBe("no_attachments");
  });

  it("returns null for a row written before the vocabulary existed", () => {
    expect(parseOcrFailureCause("Failed to extract text from any attachment")).toBeNull();
    expect(parseOcrFailureCause("ocr_cause:something_else and more")).toBeNull();
    expect(parseOcrFailureCause(null)).toBeNull();
  });
});

describe("formatClientOcrFailure", () => {
  it("leads with the code, so truncation can only cost detail", () => {
    const message = formatClientOcrFailure("upload_failed", "x".repeat(2000));
    expect(message.length).toBe(MAX_OCR_ERROR_LENGTH);
    expect(parseOcrFailureCause(message)).toBe("upload_failed");
  });
});

describe("translateOcrFailure", () => {
  const t = (key: string) => `translated:${key}`;

  it("translates a classified failure", () => {
    expect(translateOcrFailure("ocr_cause:unreadable_document all 1 page failed", t)).toBe(
      "translated:processing.ocrCause.unreadable_document",
    );
  });

  it("shows an older row as it stands rather than nothing at all", () => {
    expect(translateOcrFailure("Failed to extract text from any attachment", t)).toBe(
      "Failed to extract text from any attachment",
    );
  });

  it("falls back when there is no message", () => {
    expect(translateOcrFailure(null, t)).toBe("translated:processing.failed");
  });
});
