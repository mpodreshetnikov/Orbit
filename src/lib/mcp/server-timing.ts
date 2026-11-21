/**
 * MCP route Server-Timing helpers. Numbers only — no tokens/PII in values.
 * Metrics: auth (bearer verify), mcp (handler / challenge body), total.
 */

export type McpServerTiming = {
  authMs: number;
  mcpMs: number;
  totalMs: number;
};

export function formatMcpServerTiming(timing: McpServerTiming): string {
  const auth = Math.max(0, timing.authMs);
  const mcp = Math.max(0, timing.mcpMs);
  const total = Math.max(0, timing.totalMs);
  return `auth;dur=${auth.toFixed(1)}, mcp;dur=${mcp.toFixed(1)}, total;dur=${total.toFixed(1)}`;
}

export function withServerTimingHeader(response: Response, timing: McpServerTiming): Response {
  const headers = new Headers(response.headers);
  headers.set("Server-Timing", formatMcpServerTiming(timing));
  headers.set(
    "Access-Control-Expose-Headers",
    mergeExposeHeaders(headers.get("Access-Control-Expose-Headers")),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mergeExposeHeaders(existing: string | null): string {
  if (!existing) return "Server-Timing";
  const parts = existing.split(",").map((part) => part.trim().toLowerCase());
  if (parts.includes("server-timing")) return existing;
  return `${existing}, Server-Timing`;
}
