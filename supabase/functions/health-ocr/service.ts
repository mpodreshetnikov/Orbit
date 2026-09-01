import { encodeBase64 } from "std/encoding/base64";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import { type LlmUsage, sumLlmUsage, usageAttrs } from "../_shared/llm-usage.ts";
import { ClaimLostError } from "../_shared/processing-claim.ts";
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

async function downloadOneDataUrl(
  deps: HealthOcrServiceDeps,
  attachment: OcrAttachment,
): Promise<OcrAttachmentPayload | null> {
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

  const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()));
  return {
    url: `data:${attachment.mime_type};base64,${base64}`,
    mimeType: attachment.mime_type,
  };
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

    const pageTexts: string[] = [];
    const pageUsage: LlmUsage[] = [];
    let suggestedTitle = defaultTitle;

    for (let index = 0; index < attachments.length; index++) {
      const attachment = attachments[index];
      const ocrInputType = getOcrInputType(attachment.mime_type);
      const pageSpan = telemetry?.startSpan("edge.health_ocr.page", {
        attrs: {
          attachment_index: index,
          attachment_mime_type: attachment.mime_type,
          ocr_input_type: ocrInputType,
        },
      });
      const dataUrl = await downloadOneDataUrl(deps, attachment);
      if (!dataUrl) {
        await pageSpan?.end({
          status: "error",
          statusMessage: "Attachment download failed",
          attrs: {
            attachment_mime_type: attachment.mime_type,
            ocr_input_type: ocrInputType,
          },
        });
        pageTexts.push("");
        continue;
      }

      try {
        const result = await deps.openRouterClient.callVisionOcrSingle(dataUrl, {
          requestTitle: index === 0,
        });
        pageTexts.push(result.ocr_text);
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
          },
        });
        pageTexts.push("");
      }

      // A ten-page document with retries and provider backoff can outlive any lease short enough
      // to free a record from a dead worker, so a live run says after each page that it is still
      // here. Outside the per-page catch on purpose: losing the record is not a page that failed,
      // it is the end of this run's right to write anything.
      if (!(await deps.repository.renewClaim(recordId, runId))) {
        throw new ClaimLostError(recordId);
      }
    }

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
