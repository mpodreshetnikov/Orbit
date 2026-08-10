import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createUserScopedSupabaseClient } from "./supabase-user-client";
import { resolvePerson, type PersonRef } from "./resolve-person";
import { fail, type ToolResult } from "./tool-result";
import type { McpAuthExtra } from "./verify-token";

/**
 * Glue between a tool callback and the data layer.
 *
 * Two jobs. First, pull the authenticated grant out of the request context and
 * turn it into a user-scoped Supabase client, so the tool's queries run under
 * the caller's own RLS. Second, contain failures: anything that throws inside a
 * tool becomes an `isError` result the model can read and react to, rather than
 * a transport-level error that would look like an auth problem and send the
 * client back through OAuth.
 */

/** Shape of the context object the SDK hands a tool callback. */
export interface ToolContext {
  http?: { authInfo?: { extra?: Record<string, unknown>; scopes?: string[] } };
}

export function getAuthFromContext(ctx: ToolContext): McpAuthExtra {
  const extra = ctx.http?.authInfo?.extra;
  const grantId = extra?.grantId;
  const authUserId = extra?.authUserId;
  const userEmail = extra?.userEmail;

  if (
    typeof grantId !== "string" ||
    typeof authUserId !== "string" ||
    typeof userEmail !== "string"
  ) {
    // Unreachable in practice: the transport is wrapped in withMcpAuth, so an
    // unauthenticated call never reaches a tool.
    throw new Error("Tool call is missing authentication context.");
  }

  return { grantId, authUserId, userEmail };
}

export function getScopesFromContext(ctx: ToolContext): string[] {
  return ctx.http?.authInfo?.scopes ?? [];
}

export type ToolHandler<Args> = (
  supabase: SupabaseClient<Database>,
  args: Args,
  auth: McpAuthExtra,
) => Promise<ToolResult>;

export interface ToolOptions {
  /**
   * Scope this tool needs. The consent screen lets a user grant read without
   * write, and `intersectScopes` lets a client register for less, so this has
   * to be enforced per call -- otherwise a read-only token could still write,
   * and the consent screen would be lying about what it authorized.
   */
  requiredScope?: string;
}

export function withUserClient<Args>(handler: ToolHandler<Args>, options: ToolOptions = {}) {
  return async (args: Args, ctx: ToolContext): Promise<ToolResult> => {
    if (options.requiredScope) {
      const scopes = getScopesFromContext(ctx);
      if (!scopes.includes(options.requiredScope)) {
        return fail(
          `This connection was granted [${scopes.join(", ") || "no scopes"}] and does not include "${options.requiredScope}", which this tool requires. Ask the user to reconnect and approve write access.`,
        );
      }
    }

    let supabase: SupabaseClient<Database>;
    try {
      supabase = createUserScopedSupabaseClient(getAuthFromContext(ctx));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return fail(`Could not establish a database session for this request: ${message}`);
    }

    try {
      return await handler(supabase, args, getAuthFromContext(ctx));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return fail(message);
    }
  };
}

/**
 * Wrapper for the many tools that operate on one person. Short-circuits with a
 * helpful message (including the candidate list) when the person is ambiguous,
 * so the model can ask rather than guess.
 */
export function withPerson<Args extends { person_id?: string; person_name?: string }>(
  handler: (
    supabase: SupabaseClient<Database>,
    person: PersonRef,
    args: Args,
    auth: McpAuthExtra,
  ) => Promise<ToolResult>,
  options: ToolOptions = {},
) {
  return withUserClient<Args>(async (supabase, args, auth) => {
    const resolution = await resolvePerson(supabase, args);
    if (resolution.status !== "ok") {
      return fail(resolution.message, { candidates: resolution.candidates });
    }
    return handler(supabase, resolution.person, args, auth);
  }, options);
}
