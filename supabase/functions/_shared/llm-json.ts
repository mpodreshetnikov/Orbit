/**
 * Reading a JSON answer back out of a model response.
 *
 * Two things go wrong often enough to be worth handling in one place rather than at each call
 * site: the content arrives as an array of parts rather than a string, and the JSON arrives
 * wrapped in a fenced code block despite the request asking for bare JSON.
 */

export const INVALID_JSON_ERROR_MESSAGE = "OpenRouter returned invalid JSON content";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Flatten a chat message's content to text.
 *
 * `content` is a string for most providers and an array of typed parts for some; treating the
 * array case as "no content" would fail the call over a difference that carries no meaning.
 */
export function extractContentText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const text = asRecord(part).text;
        return typeof text === "string" ? text : "";
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return "";
}

/**
 * Parse a model answer that should be a JSON object.
 *
 * Tries the raw text first, then the contents of a fenced code block, because models
 * intermittently wrap JSON in ``` even when asked not to.
 */
export function parseJsonObject(contentText: string): Record<string, unknown> {
  const trimmed = contentText.trim();
  const candidates: string[] = [];
  if (trimmed.length > 0) candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  throw new Error(INVALID_JSON_ERROR_MESSAGE);
}
