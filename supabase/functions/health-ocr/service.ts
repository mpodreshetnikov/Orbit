import { encodeBase64 } from "std/encoding/base64";
import type { EdgeTelemetry } from "../_shared/observability.ts";
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

export async function runHealthOcrService(
  input: HealthOcrServiceInput,
  deps: HealthOcrServiceDeps,
): Promise<ServiceResult> {
  const log = deps.log ?? console;
  const telemetry = deps.telemetry;
  const startMs = (deps.now ?? (() => Date.now()))();
  const maxOcrErrorLength = deps.maxOcrErrorLength ?? DEFAULT_MAX_OCR_ERROR_LENGTH;
  const defaultTitle = deps.defaultTitle ?? DEFAULT_TITLE;
  const recordId = input.recordId;
  let shouldMarkFailure = false;
  const serviceSpan = telemetry?.startSpan("edge.health_ocr.service", {
    attrs: {
      has_record_id: Boolean(recordId),
    },
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
    shouldMarkFailure = true;

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
        await pageSpan?.end({
          status: "ok",
          attrs: {
            attachment_mime_type: attachment.mime_type,
            ocr_input_type: ocrInputType,
            ocr_chars: result.ocr_text.length,
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
    }

    if (pageTexts.every((text) => !text.trim())) {
      throw new Error("Failed to extract text from any attachment");
    }

    const fullOcrText = buildCombinedPageText(pageTexts);
    const persistSpan = telemetry?.startSpan("edge.health_ocr.persist_record");
    await deps.repository.updateRecordSuccess(recordId, {
      ocrText: fullOcrText,
      title: suggestedTitle,
    });
    await persistSpan?.end({
      status: "ok",
      attrs: {
        full_text_chars: fullOcrText.length,
      },
    });

    log.log(
      "[health-ocr] success record_id:",
      recordId,
      "duration_ms:",
      (deps.now ?? (() => Date.now()))() - startMs,
    );
    telemetry?.info("health_ocr_service_completed", {
      record_id: recordId,
      duration_ms: (deps.now ?? (() => Date.now()))() - startMs,
      char_count: fullOcrText.length,
    });
    await serviceSpan?.end({
      status: "ok",
      attrs: {
        duration_ms: (deps.now ?? (() => Date.now()))() - startMs,
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
    const truncatedMessage = errorMessage.slice(0, maxOcrErrorLength);
    log.error(
      "[health-ocr] error record_id:",
      recordId,
      "duration_ms:",
      (deps.now ?? (() => Date.now()))() - startMs,
      "error:",
      error,
    );
    telemetry?.error("health_ocr_service_failed", {
      record_id: recordId ?? "missing",
      duration_ms: (deps.now ?? (() => Date.now()))() - startMs,
      error_message: errorMessage,
    });

    if (recordId && shouldMarkFailure) {
      try {
        const failureSpan = telemetry?.startSpan("edge.health_ocr.persist_failure");
        await deps.repository.updateRecordFailure(recordId, truncatedMessage);
        await failureSpan?.end({ status: "ok" });
      } catch (updateError) {
        log.error("Failed to update record with ocr_failed:", updateError);
      }
    }
    await serviceSpan?.end({
      status: "error",
      statusMessage: errorMessage,
      attrs: {
        duration_ms: (deps.now ?? (() => Date.now()))() - startMs,
      },
    });

    return {
      status: 400,
      payload: {
        success: false,
        error: errorMessage,
      },
    };
  }
}
