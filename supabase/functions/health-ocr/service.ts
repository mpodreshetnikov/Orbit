import { encodeBase64 } from "std/encoding/base64";
import { selectSuggestedTitle } from "./title.ts";
import type { OpenRouterOcrClient, OcrImageDataUrl } from "./openrouter-client.ts";
import type { HealthOcrRepository, OcrAttachment } from "./repository.ts";

export interface HealthOcrServiceDeps {
  repository: HealthOcrRepository;
  openRouterClient: OpenRouterOcrClient;
  maxAttachmentBytes?: number;
  maxOcrErrorLength?: number;
  defaultTitle?: string;
  now?: () => number;
  log?: Pick<Console, "log" | "error">;
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
): Promise<OcrImageDataUrl | null> {
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
  const startMs = (deps.now ?? (() => Date.now()))();
  const maxOcrErrorLength = deps.maxOcrErrorLength ?? DEFAULT_MAX_OCR_ERROR_LENGTH;
  const defaultTitle = deps.defaultTitle ?? DEFAULT_TITLE;
  const recordId = input.recordId;
  let shouldMarkFailure = false;

  try {
    const user = await deps.repository.authenticateUser(input.authToken);
    if (!user) {
      throw new Error("Unauthorized - invalid token");
    }

    const allowed = await deps.repository.isAllowedUser(user);
    if (!allowed) {
      throw new Error("User not in allowlist");
    }

    if (!recordId) {
      throw new Error("Missing required field: record_id");
    }
    shouldMarkFailure = true;

    const record = await deps.repository.getRecord(recordId);
    if (!record) {
      throw new Error("Record not found or access denied");
    }

    const attachments = await deps.repository.getAttachments(recordId);
    if (attachments.length === 0) {
      throw new Error("No attachments found for this record");
    }

    const pageTexts: string[] = [];
    let suggestedTitle = defaultTitle;

    for (let index = 0; index < attachments.length; index++) {
      const dataUrl = await downloadOneDataUrl(deps, attachments[index]);
      if (!dataUrl) {
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
      } catch (error) {
        log.error(`OCR failed for ${attachments[index].storage_path}:`, error);
        pageTexts.push("");
      }
    }

    if (pageTexts.every((text) => !text.trim())) {
      throw new Error("Failed to extract text from any attachment");
    }

    const fullOcrText = buildCombinedPageText(pageTexts);
    await deps.repository.updateRecordSuccess(recordId, {
      ocrText: fullOcrText,
      title: suggestedTitle,
    });

    log.log(
      "[health-ocr] success record_id:",
      recordId,
      "duration_ms:",
      (deps.now ?? (() => Date.now()))() - startMs,
    );

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

    if (recordId && shouldMarkFailure) {
      try {
        await deps.repository.updateRecordFailure(recordId, truncatedMessage);
      } catch (updateError) {
        log.error("Failed to update record with ocr_failed:", updateError);
      }
    }

    return {
      status: 400,
      payload: {
        success: false,
        error: errorMessage,
      },
    };
  }
}
