import { extractContentText, parseJsonObject } from "../_shared/llm-json.ts";
import { type LlmUsage, parseLlmUsage, sumLlmUsage } from "../_shared/llm-usage.ts";
import {
  NO_PROVIDER_RESPONSE_MESSAGE,
  OcrProviderError,
  UnsupportedOcrMediaError,
} from "./failure.ts";
import {
  DEFAULT_MAX_ATTEMPTS,
  isRetryableStatus,
  parseRetryAfterMs,
  RetryableLlmError,
  withLlmRetry,
} from "../_shared/llm-retry.ts";

export interface OcrAttachmentPayload {
  url: string;
  mimeType: string;
}

export interface OcrResult {
  ocr_text: string;
  suggested_title: string;
  /**
   * True when the model hit its completion budget before finishing the page, so `ocr_text` is
   * the beginning of the document rather than all of it. Callers must not treat a truncated
   * page as a complete transcription — everything downstream reads it as the whole document.
   */
  truncated: boolean;
  /**
   * What the provider charged for this page, across every attempt that reached the model --
   * a truncated answer is a billed call even though it is thrown away and retried.
   */
  usage: LlmUsage;
}

export interface OpenRouterOcrClient {
  callVisionOcrSingle(
    attachment: OcrAttachmentPayload,
    options: { requestTitle: boolean },
  ): Promise<OcrResult>;
}

interface CreateOpenRouterOcrClientDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  referer: string;
  timeoutMs?: number;
  model?: string;
  maxTokens?: number;
  maxAttempts?: number;
  /** Injected so tests do not actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Injected so backoff jitter is deterministic under test. */
  jitterFn?: () => number;
  log?: Pick<Console, "log" | "warn" | "error">;
}

type OpenRouterUserContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: { url: string };
    }
  | {
      type: "file";
      file: { filename: string; file_data: string };
    };

const DEFAULT_TIMEOUT_MS = 55_000;
const DEFAULT_MODEL = "openai/gpt-5.2:nitro";
const DEFAULT_MAX_TOKENS = 12_000;
const DEFAULT_FALLBACK_TITLE = "Медицинский документ";

export const TRUNCATED_ERROR_MESSAGE = "OpenRouter OCR response was truncated before completion";

/**
 * The transcription contract, sent as a strict schema rather than described in prose.
 *
 * `json_object` only asks for *some* JSON; the model remains free to invent field names, and a
 * missing `ocr_text` then reads as an empty page. A strict schema makes both fields mandatory.
 */
const OCR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ocr_text", "suggested_title"],
  properties: {
    ocr_text: { type: "string" },
    suggested_title: { type: "string" },
  },
} as const;

function createSystemPrompt(requestTitle: boolean): string {
  const lines = [
    "You are an OCR assistant for medical documents.",
    "Transcribe every readable character exactly as printed, in the document's own language.",
    "Preserve numbers, units and reference ranges character for character — they are lab values and a changed digit is a changed diagnosis.",
    "Do not translate, correct, summarise, reorder or complete anything. Transcribe only what is visible.",
    "Where text is illegible, write [нрзб] rather than guessing at it.",
    // A lab report is a table, and flattening one to prose is where a value ends up beside the
    // wrong analyte's unit or reference range. The structure is part of what is printed.
    "Write the transcription as GitHub-flavoured Markdown.",
    "Where the document lays content out as a table, transcribe it as a Markdown table with the same rows and columns, so each value stays with its own analyte, unit and reference range.",
    "Keep a cell empty when the document leaves it empty. Never move a value into a neighbouring column to fill a gap.",
    "Text that is not tabular stays plain text. Do not invent headings, bullets or emphasis the document does not have.",
  ];
  lines.push(
    requestTitle
      ? "Also suggest a short title for the document."
      : "Return an empty string for suggested_title.",
  );
  return lines.join("\n");
}

export function createOpenRouterOcrClient(
  deps: CreateOpenRouterOcrClientDeps,
): OpenRouterOcrClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = deps.model ?? DEFAULT_MODEL;
  const baseMaxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;

  function buildAttachmentContentPart(attachment: OcrAttachmentPayload): OpenRouterUserContentPart {
    if (attachment.mimeType.startsWith("image/")) {
      return {
        type: "image_url",
        image_url: { url: attachment.url },
      };
    }

    if (attachment.mimeType === "application/pdf") {
      return {
        type: "file",
        file: {
          filename: "document.pdf",
          file_data: attachment.url,
        },
      };
    }

    throw new UnsupportedOcrMediaError(attachment.mimeType);
  }

  return {
    async callVisionOcrSingle(attachment, options) {
      // Built before the retry loop so an unsupported MIME type fails once rather than three times.
      const attachmentPart = buildAttachmentContentPart(attachment);
      const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      // Every attempt that reached the model was billed, the truncated ones that are retried for
      // a larger budget included. Reporting only the last would understate exactly the long
      // documents that retry most.
      const billed: LlmUsage[] = [];

      const outcome = await withLlmRetry(
        async (attempt) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const response = await deps.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${deps.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": deps.referer,
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: "system", content: createSystemPrompt(options.requestTitle) },
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: options.requestTitle
                          ? "Transcribe this document and suggest a short title."
                          : "Transcribe this document.",
                      },
                      attachmentPart,
                    ],
                  },
                ],
                temperature: 0,
                // A page that overran its budget gets a larger one, otherwise the retry
                // reproduces the same truncation at the same point.
                max_tokens: baseMaxTokens * Math.pow(2, attempt),
                // Without this, OpenRouter may route to a provider that ignores response_format
                // and returns prose, which surfaces as an unreproducible parse failure.
                provider: { require_parameters: true },
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "health_ocr_transcription",
                    strict: true,
                    schema: OCR_SCHEMA,
                  },
                },
              }),
            });

            if (!response.ok) {
              const message = `OpenRouter API error: ${response.status}`;
              if (isRetryableStatus(response.status)) {
                throw new RetryableLlmError(
                  message,
                  parseRetryAfterMs(response.headers.get("retry-after"), Date.now()),
                );
              }
              // The provider's body can quote the request, which for OCR includes the image, so
              // only the status travels — and it travels typed, because the caller has to tell a
              // rejected key from a refused request without parsing this message back apart.
              throw new OcrProviderError(message, response.status);
            }

            const payload = (await response.json()) as {
              choices?: Array<{ finish_reason?: string; message?: Record<string, unknown> }>;
              usage?: Record<string, unknown>;
            };
            const choice = payload.choices?.[0];
            const contentText = extractContentText(choice?.message ?? {});
            if (!contentText) throw new Error(NO_PROVIDER_RESPONSE_MESSAGE);

            const parsed = parseJsonObject(contentText);
            const ocrText = typeof parsed.ocr_text === "string" ? parsed.ocr_text : "";
            const suggestedTitle =
              typeof parsed.suggested_title === "string" ? parsed.suggested_title.trim() : "";
            billed.push(parseLlmUsage(payload));
            const result: OcrResult = {
              ocr_text: ocrText,
              suggested_title: suggestedTitle || DEFAULT_FALLBACK_TITLE,
              truncated: choice?.finish_reason === "length",
              usage: sumLlmUsage(billed),
            };

            // Retried for the larger budget, not because the answer was malformed. Once the
            // attempts are spent, the partial transcription is returned rather than thrown: the
            // caller substitutes an empty string for a failure, so throwing loses the page whole,
            // while a page read as far as it got still yields real values.
            if (result.truncated) {
              if (attempt < maxAttempts - 1) {
                throw new RetryableLlmError(TRUNCATED_ERROR_MESSAGE);
              }
              deps.log?.warn?.(
                JSON.stringify({
                  health_ocr_truncated: true,
                  // Length only — the text itself is the patient's document.
                  ocr_chars: result.ocr_text.length,
                }),
              );
            }

            return result;
          } catch (error) {
            if ((error as { name?: string }).name === "AbortError") {
              throw new RetryableLlmError("OpenRouter request timed out");
            }
            if (error instanceof TypeError) {
              throw new RetryableLlmError(`OpenRouter request failed: ${error.message}`);
            }
            throw error;
          } finally {
            clearTimeout(timeoutId);
          }
        },
        {
          maxAttempts: deps.maxAttempts,
          sleepFn: deps.sleepFn,
          jitterFn: deps.jitterFn,
          log: deps.log,
        },
      );

      return outcome.value;
    },
  };
}
