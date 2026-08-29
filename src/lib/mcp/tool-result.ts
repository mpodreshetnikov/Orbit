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

/**
 * Renders one page of a list, naming the window and how to ask for the next.
 *
 * `summarizeList` truncates at its preview limit and says "...and N more" with
 * no way to reach them, which left the rows past the cap unreachable except by
 * guessing search terms. A tool that pages says which rows these are and what
 * `offset` continues the listing, so the model can finish the job itself.
 */
export function summarizePage(
  label: string,
  items: string[],
  page: { total: number; offset: number; has_more: boolean; next_offset: number | null },
): string {
  if (page.total === 0) {
    return `No ${label} found.`;
  }

  // An offset past the end -- asked for directly, or reached after rows were
  // removed between two calls -- returns nothing while the total stays
  // positive. Rendering that as a window would print an impossible range like
  // "showing 41-40", which reads as a broken tool rather than an exhausted
  // page, so say what happened and where the last page starts.
  if (items.length === 0) {
    const lastPageOffset = Math.max(0, page.total - 1);
    return (
      `${page.total} ${label}, but offset ${page.offset} is past the end. ` +
      `Pass an offset below ${page.total} — offset: 0 starts again from the first.` +
      `${lastPageOffset > 0 ? ` The last row is at offset ${lastPageOffset}.` : ""}`
    );
  }

  const window =
    items.length === page.total
      ? ""
      : ` (showing ${page.offset + 1}-${page.offset + items.length})`;
  const lines = items.map((item) => `- ${item}`);
  if (page.has_more) {
    lines.push(
      `- ...${page.total - page.offset - items.length} more; pass offset: ${page.next_offset} to continue`,
    );
  }

  return [`${page.total} ${label}${window}:`, ...lines].join("\n");
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
