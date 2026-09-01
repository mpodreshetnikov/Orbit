import { encodeBase64 } from "std/encoding/base64";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import { type LlmUsage, sumLlmUsage, usageAttrs } from "../_shared/llm-usage.ts";
import { ClaimLostError } from "../_shared/processing-claim.ts";
import type { PreprocessedImage } from "./image-preprocess.ts";
import { selectSuggestedTitle } from "./title.ts";
import type { OpenRouterOcrClient, OcrAttachmentPayload } from "./openrouter-client.ts";
import type { HealthOcrRepository, OcrAttachment } from "./repository.ts";

export interface HealthOcrServiceDeps {
  repository: HealthOcrRepository;
  openRouterClient: OpenRouterOcrClient;
  maxAttachmentBytes?: number;
  maxOcrErrorLength?: number;
  defaultTitle?: string;
  now?: () => number;
  log?: Pick<Console, "log" | "error">;
  telemetry?: EdgeTelemetry;
  /** How many pages are transcribed at once. */
  pageConcurrency?: number;
  /**
   * Normalise a raster page before it is encoded, or report that it cannot be normalised.
   *
   * Injected rather than imported so the codec -- a wasm one, fetched on first use -- is
   * reached only by the deployed function. Absent, pages are sent exactly as they were stored.
   */
  preprocessImage?: (
    bytes: Uint8Array,
    mimeType: string,
    options?: { log?: Pick<Console, "log" | "error"> },
  ) => Promise<PreprocessedImage | null>;
}

export interface HealthOcrServiceInput {
  authToken: string;
  recordId: string | null;
}

type ServiceResult = {
  status: number;
  payload: Record<string, unknown>;
};

export interface HealthOcrAcceptance {
  status: number;
  payload: Record<string, unknown>;
  /**
   * The work the accepted request stands for, present only when this run holds the claim.
   * The caller runs it after the response has gone out; its result is what the record's status
   * will say, not what any caller is still waiting for.
   */
  work?: () => Promise<ServiceResult>;
}

const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_OCR_ERROR_LENGTH = 500;
const DEFAULT_TITLE = "Медицинский документ";

/**
 * How many pages are in flight at once.
 *
 * Three, because the ceiling is the provider's rate limit rather than this function's CPU, and
 * because each page in flight is a decoded image and its base64 body held in memory at the same
 * time. It is the difference between a five-page document taking five page-times and two.
 */
const DEFAULT_PAGE_CONCURRENCY = 3;

/** One page, ready to send, and what preparing it did to its size. */
interface PreparedPage {
  payload: OcrAttachmentPayload;
  sourceBytes: number;
  sentBytes: number;
  preprocessed: boolean;
}

/**
 * Run work one call at a time, however many callers there are.
 *
 * Decoding is the one step here that is bounded by memory rather than by the provider: a
 * compressed size says nothing about pixel dimensions, so three ordinary phone photographs --
 * or one decompression bomb -- can be far more RGBA than the function has, all at once. The
 * provider calls still overlap; only the decoding is single file.
 */
function createSerialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work);
    tail = result.catch(() => {});
    return result;
  };
}

async function prepareOnePage(
  deps: HealthOcrServiceDeps,
  attachment: OcrAttachment,
  serially: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<PreparedPage | null> {
  const log = deps.log ?? console;
  const maxAttachmentBytes = deps.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const blob = await deps.repository.downloadAttachment(attachment.storage_path);
  if (!blob) {
    log.error(`Failed to download ${attachment.storage_path}`);
    return null;
  }

  if (blob.size > maxAttachmentBytes) {
    log.error(
      `Skipping ${attachment.storage_path}: size ${blob.size} exceeds ${maxAttachmentBytes}`,
    );
    return null;
  }

  const sourceBytes = new Uint8Array(await blob.arrayBuffer());
  // A page that cannot be normalised is sent as it arrived: a slightly worse transcription is
  // better than none, and a PDF has no raster to normalise in the first place.
  const preprocessed = deps.preprocessImage
    ? await serially(() => deps.preprocessImage!(sourceBytes, attachment.mime_type, { log }))
    : null;
  const sentBytes = preprocessed?.bytes ?? sourceBytes;
  const mimeType = preprocessed?.mimeType ?? attachment.mime_type;

  return {
    payload: {
      url: `data:${mimeType};base64,${encodeBase64(sentBytes)}`,
      mimeType,
    },
    sourceBytes: sourceBytes.byteLength,
    sentBytes: sentBytes.byteLength,
    preprocessed: preprocessed !== null,
  };
}

/**
 * Run `count` pages at most `limit` at a time.
 *
 * The attachment loop used to be strictly sequential, which made a five-page document take five
 * times one page for no reason -- the time is spent waiting on a provider, not on this function.
 * Bounded rather than unbounded: ten pages fired at once is a rate-limit response and ten images
 * held in memory at the same time.
 */
async function forEachPage(
  count: number,
  limit: number,
  worker: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners: Promise<void>[] = [];

  for (let slot = 0; slot < Math.min(limit, count); slot++) {
    runners.push(
      (async () => {
        while (true) {
          const index = next++;
          if (index >= count) return;
          await worker(index);
        }
      })(),
    );
  }

  await Promise.all(runners);
}

function getOcrInputType(mimeType: string): "image_url" | "file" {
  return mimeType === "application/pdf" ? "file" : "image_url";
}

function buildCombinedPageText(pageTexts: string[]): string {
  return pageTexts
    .map((text, index) =>
      text
        ? `--- Страница ${index + 1} ---\n\n${text}`
        : `--- Страница ${index + 1} ---\n\n[Не удалось извлечь текст]`,
    )
    .join("\n\n");
}

/**
 * Everything after the claim: download each attachment, transcribe it, persist the result.
 *
 * This half no longer runs inside the request. The browser used to hold the connection open for
 * the whole document and give up at two minutes, so a five-page upload ended with the client
 * writing `ocr_failed` over a run that was still working. What a caller needs synchronously is
 * only whether the work was accepted; the work itself reports through the record's own status,
 * which the client already watches over realtime.
 */
async function transcribeClaimedRecord(
  recordId: string,
  runId: string,
  deps: HealthOcrServiceDeps,
): Promise<ServiceResult> {
  const log = deps.log ?? console;
  const telemetry = deps.telemetry;
  const now = deps.now ?? (() => Date.now());
  const startMs = now();
  const maxOcrErrorLength = deps.maxOcrErrorLength ?? DEFAULT_MAX_OCR_ERROR_LENGTH;
  const defaultTitle = deps.defaultTitle ?? DEFAULT_TITLE;
  const serviceSpan = telemetry?.startSpan("edge.health_ocr.service", {
    attrs: { has_record_id: true },
  });

  try {
    const attachmentsSpan = telemetry?.startSpan("edge.health_ocr.get_attachments");
    const attachments = await deps.repository.getAttachments(recordId);
    if (attachments.length === 0) {
      await attachmentsSpan?.end({
        status: "error",
        statusMessage: "No attachments found for this record",
      });
      throw new Error("No attachments found for this record");
    }
    await attachmentsSpan?.end({
      status: "ok",
      attrs: { attachment_count: attachments.length },
    });

    // Pages are transcribed in parallel but decoded one at a time: the provider is the ceiling
    // for the first and memory is the ceiling for the second.
    const decodeSerially = createSerialQueue();

    // Indexed, not appended: pages finish out of order now, and their order is the document's.
    const pageTexts: string[] = new Array(attachments.length).fill("");
    const pageUsage: LlmUsage[] = [];
    let suggestedTitle = defaultTitle;

    await forEachPage(
      attachments.length,
      deps.pageConcurrency ?? DEFAULT_PAGE_CONCURRENCY,
      async (index) => {
        const attachment = attachments[index];
        const ocrInputType = getOcrInputType(attachment.mime_type);
        const pageSpan = telemetry?.startSpan("edge.health_ocr.page", {
          attrs: {
            attachment_index: index,
            attachment_mime_type: attachment.mime_type,
            ocr_input_type: ocrInputType,
          },
        });
        const page = await prepareOnePage(deps, attachment, decodeSerially);
        if (!page) {
          await pageSpan?.end({
            status: "error",
            statusMessage: "Attachment download failed",
            attrs: {
              attachment_mime_type: attachment.mime_type,
              ocr_input_type: ocrInputType,
            },
          });
          return;
        }

        const sizeAttrs = {
          // What normalising the page saved, in the units the provider bills and the function
          // holds in memory.
          image_source_bytes: page.sourceBytes,
          image_sent_bytes: page.sentBytes,
          image_preprocessed: page.preprocessed ? 1 : 0,
        };

        try {
          const result = await deps.openRouterClient.callVisionOcrSingle(page.payload, {
            requestTitle: index === 0,
          });
          pageTexts[index] = result.ocr_text;
          if (index === 0) {
            suggestedTitle = selectSuggestedTitle(result.suggested_title, suggestedTitle);
          }
          if (result.truncated) {
            // The page was transcribed only as far as the completion budget allowed. Everything
            // downstream reads this text as the whole document, so the shortfall has to be visible.
            log.log(
              JSON.stringify({
                health_ocr_truncated: true,
                // Length only — the transcription itself is the patient's document.
                ocr_chars: result.ocr_text.length,
              }),
            );
          }
          pageUsage.push(result.usage);
          await pageSpan?.end({
            status: "ok",
            attrs: {
              attachment_mime_type: attachment.mime_type,
              ocr_input_type: ocrInputType,
              ocr_chars: result.ocr_text.length,
              ocr_truncated: result.truncated,
              ...sizeAttrs,
              // OCR runs once per attachment and structuring once per record, so on a multi-page
              // document this is the larger half of what the record cost.
              ...usageAttrs(result.usage),
            },
          });
        } catch (error) {
          log.error(`OCR failed for ${attachment.storage_path}:`, {
            mime_type: attachment.mime_type,
            ocr_input_type: ocrInputType,
            error,
          });
          await pageSpan?.end({
            status: "error",
            statusMessage: error instanceof Error ? error.message : "OCR failed",
            attrs: {
              attachment_mime_type: attachment.mime_type,
              ocr_input_type: ocrInputType,
              ...sizeAttrs,
            },
          });
        }

        // A ten-page document with retries and provider backoff can outlive any lease short enough
        // to free a record from a dead worker, so a live run says after each page that it is still
        // here. Outside the per-page catch on purpose: losing the record is not a page that failed,
        // it is the end of this run's right to write anything.
        if (!(await deps.repository.renewClaim(recordId, runId))) {
          throw new ClaimLostError(recordId);
        }
      },
    );

    if (pageTexts.every((text) => !text.trim())) {
      throw new Error("Failed to extract text from any attachment");
    }

    const fullOcrText = buildCombinedPageText(pageTexts);
    const persistSpan = telemetry?.startSpan("edge.health_ocr.persist_record");
    await deps.repository.updateRecordSuccess(
      recordId,
      { ocrText: fullOcrText, title: suggestedTitle },
      { runId },
    );
    await persistSpan?.end({
      status: "ok",
      attrs: {
        full_text_chars: fullOcrText.length,
      },
    });

    log.log("[health-ocr] success record_id:", recordId, "duration_ms:", now() - startMs);
    telemetry?.info("health_ocr_service_completed", {
      record_id: recordId,
      duration_ms: now() - startMs,
      char_count: fullOcrText.length,
    });
    await serviceSpan?.end({
      status: "ok",
      attrs: {
        duration_ms: now() - startMs,
        // The record's whole OCR cost, so a multi-page document does not have to be summed
        // page span by page span.
        ...usageAttrs(sumLlmUsage(pageUsage)),
      },
    });

    return {
      status: 200,
      payload: {
        success: true,
        ocr_text: fullOcrText,
        char_count: fullOcrText.length,
        suggested_title: suggestedTitle || undefined,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log.error(
      "[health-ocr] error record_id:",
      recordId,
      "duration_ms:",
      now() - startMs,
      "error:",
      error,
    );
    telemetry?.error("health_ocr_service_failed", {
      record_id: recordId,
      duration_ms: now() - startMs,
      error_message: errorMessage,
    });

    await recordFailure(recordId, errorMessage.slice(0, maxOcrErrorLength), runId, deps);
    await serviceSpan?.end({
      status: "error",
      statusMessage: errorMessage,
      attrs: { duration_ms: now() - startMs },
    });

    return {
      status: 400,
      payload: { success: false, error: errorMessage },
    };
  }
}

/**
 * Leave the record able to say what happened, whatever else went wrong.
 *
 * Best-effort on purpose: a failure to write the failure must not replace the original error,
 * which is the one worth reporting.
 */
async function recordFailure(
  recordId: string,
  message: string,
  runId: string | null,
  deps: HealthOcrServiceDeps,
): Promise<void> {
  const log = deps.log ?? console;
  const telemetry = deps.telemetry;
  try {
    const failureSpan = telemetry?.startSpan("edge.health_ocr.persist_failure");
    await deps.repository.updateRecordFailure(recordId, message, {
      runId: runId ?? undefined,
    });
    await failureSpan?.end({ status: "ok" });
  } catch (updateError) {
    log.error("Failed to update record with ocr_failed:", updateError);
  }
}

/**
 * Decide, synchronously, whether this request gets to transcribe the record.
 *
 * Everything a caller can act on happens here — authentication, the record, and the claim that
 * says no second run is already working. The transcription itself is handed back as `work` for
 * the caller to run after the response has been sent.
 */
export async function acceptHealthOcrRequest(
  input: HealthOcrServiceInput,
  deps: HealthOcrServiceDeps,
): Promise<HealthOcrAcceptance> {
  const telemetry = deps.telemetry;
  const maxOcrErrorLength = deps.maxOcrErrorLength ?? DEFAULT_MAX_OCR_ERROR_LENGTH;
  const recordId = input.recordId;
  let mayRecordFailure = false;
  const acceptSpan = telemetry?.startSpan("edge.health_ocr.accept", {
    attrs: { has_record_id: Boolean(recordId) },
  });
  telemetry?.info("health_ocr_service_started", {
    has_record_id: Boolean(recordId),
  });

  try {
    const authSpan = telemetry?.startSpan("edge.health_ocr.auth");
    const user = await deps.repository.authenticateUser(input.authToken);
    if (!user) {
      await authSpan?.end({
        status: "error",
        statusMessage: "Unauthorized - invalid token",
      });
      throw new Error("Unauthorized - invalid token");
    }

    const allowed = await deps.repository.isAllowedUser(user);
    if (!allowed) {
      await authSpan?.end({
        status: "error",
        statusMessage: "User not in allowlist",
      });
      throw new Error("User not in allowlist");
    }
    await authSpan?.end({ status: "ok" });

    if (!recordId) {
      throw new Error("Missing required field: record_id");
    }
    // Only now: an unauthenticated caller carrying a known record id must not be able to stamp
    // that record as failed.
    mayRecordFailure = true;

    const recordSpan = telemetry?.startSpan("edge.health_ocr.get_record");
    const record = await deps.repository.getRecord(recordId);
    if (!record) {
      await recordSpan?.end({
        status: "error",
        statusMessage: "Record not found or access denied",
      });
      throw new Error("Record not found or access denied");
    }
    await recordSpan?.end({ status: "ok" });

    // Ownership, server-side, before any work: two invocations for the same record used to run
    // side by side, and the record's state was decided by whichever finished last.
    const claimSpan = telemetry?.startSpan("edge.health_ocr.claim");
    const runId = await deps.repository.claimRecord(recordId);
    if (!runId) {
      await claimSpan?.end({ status: "ok", attrs: { claimed: false } });
      telemetry?.info("health_ocr_already_running", { record_id: recordId });
      await acceptSpan?.end({ status: "ok", attrs: { claimed: false } });
      return {
        status: 409,
        // Another run owns the record; marking it failed here would report that run's progress
        // as this caller's failure.
        payload: { success: false, error: "OCR is already running for this record" },
      };
    }
    await claimSpan?.end({ status: "ok", attrs: { claimed: true } });
    await acceptSpan?.end({ status: "ok", attrs: { claimed: true } });

    return {
      status: 202,
      payload: { success: true, accepted: true, record_id: recordId },
      work: () => transcribeClaimedRecord(recordId, runId, deps),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    telemetry?.error("health_ocr_service_failed", {
      record_id: recordId ?? "missing",
      error_message: errorMessage,
    });

    if (recordId && mayRecordFailure) {
      // No claim was taken, so the write is unconditional: nothing else can be working on the
      // record, and the caller has to be able to see why nothing happened.
      await recordFailure(recordId, errorMessage.slice(0, maxOcrErrorLength), null, deps);
    }
    await acceptSpan?.end({ status: "error", statusMessage: errorMessage });

    return {
      status: 400,
      payload: { success: false, error: errorMessage },
    };
  }
}

/**
 * Accept and transcribe in one call, reporting the transcription's own result.
 *
 * The inline shape: used by tests and by any caller that wants the text back rather than a
 * record to watch.
 */
export async function runHealthOcrService(
  input: HealthOcrServiceInput,
  deps: HealthOcrServiceDeps,
): Promise<ServiceResult> {
  const acceptance = await acceptHealthOcrRequest(input, deps);
  if (!acceptance.work) {
    return { status: acceptance.status, payload: acceptance.payload };
  }
  return await acceptance.work();
}
