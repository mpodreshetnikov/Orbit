import { AsyncLocalStorage } from "node:async_hooks";
import { generateRequestId } from "@shared/lib/observability/correlation";
import { createServerLogger } from "@/lib/observability/server-logger";
import { sha256Hex } from "./crypto";
import type { McpToolServer } from "./tools/types";

/**
 * Audit trail for the MCP connector (T-0019).
 *
 * Every tool call and every bearer rejection emits a structured log line that
 * is safe for Grafana: tool name, outcome, grant/client ids, person id, argument
 * *shape*, and duration — never argument values, clinical content, emails, or
 * raw tokens. See `docs/observability/mcp-usage-audit.md`.
 */

const toolNameStorage = new AsyncLocalStorage<string>();

/** Mutable bag for one tool invocation — person id is set after resolve, read at outcome. */
export interface McpToolAuditScope {
  personId?: string;
  /** Shared across start + completed for this invocation (OTLP request_id). */
  requestId: string;
}

const toolAuditScopeStorage = new AsyncLocalStorage<McpToolAuditScope>();

export type McpAuthRejectReason =
  | "missing_token"
  | "unknown"
  | "revoked"
  | "expired"
  | "not_allowlisted";

export type McpToolOutcome = "ok" | "error";

/** Stable hashed actor id for `user_id_hash` (never the raw auth user id). */
export function hashMcpUserId(authUserId: string): string {
  return sha256Hex(authUserId).slice(0, 16);
}

/** Sorted argument keys only — never values. */
export function mcpArgumentShape(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return "";
  }
  return Object.keys(args as Record<string, unknown>)
    .sort()
    .join(",");
}

export function runWithMcpToolName<T>(toolName: string, fn: () => T): T {
  return toolNameStorage.run(toolName, fn);
}

export function currentMcpToolName(): string {
  return toolNameStorage.getStore() ?? "unknown";
}

export function runWithMcpToolAuditScope<T>(fn: () => T): T {
  return toolAuditScopeStorage.run({ requestId: generateRequestId() }, fn);
}

export function noteMcpResolvedPersonId(personId: string): void {
  const scope = toolAuditScopeStorage.getStore();
  // Outside an audit scope this is a no-op (tests call it that way on purpose).
  if (!scope) return;
  scope.personId = personId;
}

/** Note person from an args.person_id string when present (no values logged). */
export function noteMcpPersonIdFromArgs(args: unknown): void {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const personId = (args as { person_id?: unknown }).person_id;
  if (typeof personId === "string" && personId.length > 0) {
    noteMcpResolvedPersonId(personId);
  }
}

/** Note person from a loaded person-owned row (record, checkup, …). */
export function noteMcpPersonFromRow(row: { person_id?: unknown } | null | undefined): void {
  const personId = row?.person_id;
  if (typeof personId === "string" && personId.length > 0) {
    noteMcpResolvedPersonId(personId);
  }
}

export function currentMcpPersonId(): string | undefined {
  return toolAuditScopeStorage.getStore()?.personId;
}

export function currentMcpToolRequestId(): string | undefined {
  return toolAuditScopeStorage.getStore()?.requestId;
}

/**
 * Wrap `registerTool` so every handler runs under the tool's registered name.
 * Applied once at the MCP route so health tools and MCP Apps share one ALS.
 */
export function installMcpToolNamePropagation(server: McpToolServer): void {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  server.registerTool = ((name: string, config: unknown, handler: unknown) =>
    original(name, config, (args: unknown, extra: unknown) =>
      toolNameStorage.run(String(name), () =>
        (handler as (a: unknown, e: unknown) => unknown)(args, extra),
      ),
    )) as McpToolServer["registerTool"];
}

// Stryker disable all: empty `{ userIdHash }` / `{}` spreads are equivalent when hash is unset
function mcpToolLogger(userIdHash?: string) {
  const scope = toolAuditScopeStorage.getStore();
  return createServerLogger({
    component: "mcp-tool",
    // One request_id for start + completed of the same invocation.
    ...(scope?.requestId ? { requestId: scope.requestId } : {}),
    ...(userIdHash ? { userIdHash } : {}),
  });
}

function mcpAuthLogger(userIdHash?: string) {
  return createServerLogger({
    component: "mcp-auth",
    ...(userIdHash ? { userIdHash } : {}),
  });
}
// Stryker restore all

export function logMcpToolCallStarted(attrs: {
  tool: string;
  grantId: string;
  clientId: string | null;
  userIdHash: string;
  argKeys: string;
  personId?: string | null;
}): void {
  mcpToolLogger(attrs.userIdHash).info("mcp_tool_call_started", {
    tool: attrs.tool,
    grant_id: attrs.grantId,
    client_id: attrs.clientId,
    arg_keys: attrs.argKeys,
    // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: nullish coalesce to null is the wire shape
    person_id: attrs.personId ?? null,
  });
}

export function logMcpToolCallCompleted(attrs: {
  tool: string;
  outcome: McpToolOutcome;
  durationMs: number;
  grantId: string;
  clientId: string | null;
  userIdHash: string;
  argKeys: string;
  personId?: string | null;
}): void {
  mcpToolLogger(attrs.userIdHash).info("mcp_tool_call_completed", {
    tool: attrs.tool,
    outcome: attrs.outcome,
    duration_ms: Math.round(attrs.durationMs),
    grant_id: attrs.grantId,
    client_id: attrs.clientId,
    arg_keys: attrs.argKeys,
    // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: nullish coalesce to null is the wire shape
    person_id: attrs.personId ?? null,
  });
}

export function logMcpAuthAccepted(attrs: {
  grantId: string;
  clientId: string;
  userIdHash: string;
  durationMs: number;
}): void {
  mcpAuthLogger(attrs.userIdHash).info("mcp_auth_accepted", {
    grant_id: attrs.grantId,
    client_id: attrs.clientId,
    outcome: "accepted",
    duration_ms: Math.round(attrs.durationMs),
  });
}

export function logMcpAuthRejected(attrs: {
  reason: McpAuthRejectReason;
  durationMs: number;
  grantId?: string | null;
  clientId?: string | null;
  userIdHash?: string | null;
  /** First 8 hex of sha256(token) — correlates probes without exposing the secret. */
  tokenHashPrefix?: string | null;
}): void {
  // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: unset hash omits userIdHash either way
  mcpAuthLogger(attrs.userIdHash ?? undefined).warn("mcp_auth_rejected", {
    outcome: "rejected",
    reason: attrs.reason,
    duration_ms: Math.round(attrs.durationMs),
    grant_id: attrs.grantId ?? null,
    client_id: attrs.clientId ?? null,
    token_hash_prefix: attrs.tokenHashPrefix ?? null,
  });
}
