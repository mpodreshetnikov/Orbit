import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Shared shape for every tool's return value.
 *
 * Each result carries two things: a short human-readable `text` block, which is
 * what the model actually reads and reasons over, and `structuredContent`,
 * which is the machine payload it can chain into the next call. Dumping raw
 * JSON into the text block instead would roughly double the token cost of every
 * response for no benefit, so keep the summary genuinely short.
 */

/**
 * Aliased to the SDK's own result type rather than hand-rolled, so a tool that
 * returns the wrong shape fails at compile time instead of at call time.
 */
export type ToolResult = CallToolResult;

export function ok(summary: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: summary }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * A failed tool call. This is NOT an auth failure -- those are handled at the
 * transport layer and produce a 401. Anything reaching here (a bad argument, a
 * missing row, a database error) is reported to the model so it can adjust and
 * retry, rather than tearing down the connection.
 */
export function fail(message: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    ...(structured ? { structuredContent: structured } : {}),
    isError: true,
  };
}

/** Renders a compact list preview so the model can see the data without parsing JSON. */
export function summarizeList(
  label: string,
  items: string[],
  total: number,
  previewLimit = 20,
): string {
  if (total === 0) {
    return `No ${label} found.`;
  }

  const shown = items.slice(0, previewLimit);
  const lines = shown.map((item) => `- ${item}`);
  if (total > shown.length) {
    lines.push(`- ...and ${total - shown.length} more`);
  }

  return [`${total} ${label}:`, ...lines].join("\n");
}

export function paginate<T>(
  items: T[],
  limit: number,
  offset: number,
): { page: T[]; total_returned: number; has_more: boolean; next_offset: number | null } {
  const page = items.slice(offset, offset + limit);
  const hasMore = offset + page.length < items.length;

  return {
    page,
    total_returned: page.length,
    has_more: hasMore,
    next_offset: hasMore ? offset + page.length : null,
  };
}
