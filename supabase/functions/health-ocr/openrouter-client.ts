export interface OcrImageDataUrl {
  url: string;
  mimeType: string;
}

export interface OcrResult {
  ocr_text: string;
  suggested_title: string;
}

export interface OpenRouterOcrClient {
  callVisionOcrSingle(
    imageDataUrl: OcrImageDataUrl,
    options: { requestTitle: boolean },
  ): Promise<OcrResult>;
}

interface CreateOpenRouterOcrClientDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  referer: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 55_000;
const DEFAULT_FALLBACK_TITLE = "Медицинский документ";

function createSystemPrompt(requestTitle: boolean): string {
  if (!requestTitle) {
    return [
      "You are an OCR assistant for medical documents.",
      "Extract all readable text exactly and return JSON with fields:",
      "- ocr_text (string)",
      '- suggested_title ("")',
    ].join("\n");
  }

  return [
    "You are an OCR assistant for medical documents.",
    "Extract all readable text exactly and suggest a short title.",
    "Return JSON with fields:",
    "- ocr_text (string)",
    "- suggested_title (short string)",
  ].join("\n");
}

export function createOpenRouterOcrClient(
  deps: CreateOpenRouterOcrClientDeps,
): OpenRouterOcrClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async callVisionOcrSingle(imageDataUrl, options) {
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
            model: "openai/gpt-4o",
            messages: [
              { role: "system", content: createSystemPrompt(options.requestTitle) },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: options.requestTitle
                      ? "Extract all text and suggest a short document title."
                      : "Extract all text from this image.",
                  },
                  {
                    type: "image_url",
                    image_url: { url: imageDataUrl.url },
                  },
                ],
              },
            ],
            temperature: 0.1,
            max_tokens: 12000,
            response_format: { type: "json_object" },
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`OpenRouter API error: ${error}`);
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error("No response from OpenRouter");

        const parsed = JSON.parse(content) as { ocr_text?: string; suggested_title?: string };
        const suggestedTitle =
          typeof parsed.suggested_title === "string" ? parsed.suggested_title.trim() : "";

        return {
          ocr_text: parsed.ocr_text || "",
          suggested_title: suggestedTitle || DEFAULT_FALLBACK_TITLE,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        if ((error as { name?: string }).name === "AbortError") {
          throw new Error("OpenRouter request timed out");
        }
        throw error;
      }
    },
  };
}
