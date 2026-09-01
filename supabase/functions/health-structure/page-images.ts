/**
 * The original pages, for the stage that has to read a table.
 *
 * Structuring used to see the transcription and nothing else, which bakes a lossy hand-off into
 * the design: whatever the OCR pass failed to express -- which column a number sat under, whether
 * a range belonged to the row above or below -- is unrecoverable by the time the extraction stage
 * reads it. The pages themselves settle those questions, so extraction gets them alongside the
 * text rather than instead of it.
 *
 * The text remains the document of record. Anchors are still quoted from it, and a page that
 * cannot be loaded costs nothing but the ambiguity it would have resolved.
 */

import { encodeBase64 } from "std/encoding/base64";
import type { PreprocessedImage } from "../_shared/image-preprocess.ts";

/**
 * How many pages are worth sending.
 *
 * Every page is an image in the extraction prompt, priced per call and repeated on every retry.
 * Four covers the documents where layout is actually load-bearing -- a lab panel, a two-page
 * ultrasound report -- without turning a ten-page discharge summary into the most expensive
 * request the pipeline makes.
 */
export const MAX_PAGE_IMAGES = 4;

/**
 * And how much they may weigh in total.
 *
 * A count alone is not a bound: four unnormalised photographs are tens of megabytes of base64 in
 * a single request body. Pages are added until either limit is reached, in document order, so
 * what survives the cut is the beginning of the document rather than an arbitrary subset.
 */
export const MAX_PAGE_IMAGE_BYTES = 4 * 1024 * 1024;

export interface PageImageAttachment {
  storage_path: string;
  mime_type: string;
}

export interface LoadPageImagesDeps {
  getAttachments(recordId: string): Promise<PageImageAttachment[]>;
  downloadAttachment(storagePath: string): Promise<Blob | null>;
  /** The same normalisation OCR applies, so the model sees the page OCR saw. */
  preprocessImage?: (
    bytes: Uint8Array,
    mimeType: string,
    options?: { log?: Pick<Console, "log" | "error"> },
  ) => Promise<PreprocessedImage | null>;
  maxImages?: number;
  maxBytes?: number;
  log?: Pick<Console, "log" | "error" | "warn">;
}

/**
 * Load the record's pages as data URLs, in document order, within both limits.
 *
 * Never throws: this is context, not content. A record whose attachments cannot be read still
 * structures from its text, exactly as it did before.
 */
export async function loadRecordPageImages(
  recordId: string,
  deps: LoadPageImagesDeps,
): Promise<string[]> {
  const log = deps.log ?? console;
  const maxImages = deps.maxImages ?? MAX_PAGE_IMAGES;
  const maxBytes = deps.maxBytes ?? MAX_PAGE_IMAGE_BYTES;

  try {
    const attachments = await deps.getAttachments(recordId);
    const images: string[] = [];
    let totalBytes = 0;

    for (const attachment of attachments) {
      if (images.length >= maxImages) break;
      // A PDF is not an image part; the transcription is all the structuring stage gets of one.
      if (!attachment.mime_type.startsWith("image/")) continue;

      const blob = await deps.downloadAttachment(attachment.storage_path);
      if (!blob) continue;

      const sourceBytes = new Uint8Array(await blob.arrayBuffer());
      const normalised = deps.preprocessImage
        ? await deps.preprocessImage(sourceBytes, attachment.mime_type, { log })
        : null;
      // A page that would not decode is dropped rather than forwarded as it was stored. OCR can
      // send a corrupt image and lose only that page, because it calls once per attachment;
      // extraction sends every page in one request, so a provider rejecting one image would take
      // the whole record's structuring with it -- and the text alone would have worked.
      if (deps.preprocessImage && !normalised) {
        log.error(`[health-structure] page ${attachment.storage_path} would not decode; omitted`);
        continue;
      }
      const bytes = normalised?.bytes ?? sourceBytes;
      const mimeType = normalised?.mimeType ?? attachment.mime_type;

      if (totalBytes + bytes.byteLength > maxBytes) break;
      totalBytes += bytes.byteLength;
      images.push(`data:${mimeType};base64,${encodeBase64(bytes)}`);
    }

    return images;
  } catch (error) {
    log.error("[health-structure] could not load page images, structuring from text alone:", error);
    return [];
  }
}
