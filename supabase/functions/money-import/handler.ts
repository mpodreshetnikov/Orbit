import { corsHeaders } from "../_shared/cors.ts";
import { resolveAuth } from "./auth.ts";
import { applyRowsAction } from "./apply-rows.ts";
import { createDefaultMoneyImportDeps, type MoneyImportDeps } from "./deps.ts";
import { jsonResponse, normalizeText } from "./normalize.ts";
import {
  completeSessionAction,
  createSessionAction,
  sessionStatusAction,
} from "./session-actions.ts";
import type { UserAuthContext } from "./types.ts";

export interface MoneyImportHandlerDeps extends MoneyImportDeps {}

function asBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function isUnauthorizedError(message: string): boolean {
  return message === "Unauthorized" || message.includes("Authorization");
}

export function createMoneyImportHandler(deps: MoneyImportHandlerDeps) {
  return async function handleMoneyImportRequest(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body: Record<string, unknown>;
    try {
      body = asBody(await req.json());
    } catch {
      body = {};
    }

    const action = normalizeText(body.action);
    if (!action) {
      return jsonResponse({ error: "action is required" }, 400);
    }

    try {
      if (action === "create_session") {
        const auth = (await resolveAuth(
          req,
          {
            authenticateAllowedUser: deps.repository.authenticateAllowedUser,
            getSessionByToken: deps.repository.getSessionByToken,
            now: () => (deps.now ?? (() => new Date()))().getTime(),
          },
          { allowUser: true, allowSession: false },
        )) as UserAuthContext;
        return await createSessionAction(body, auth, deps);
      }

      if (action === "session_status") {
        const auth = (await resolveAuth(
          req,
          {
            authenticateAllowedUser: deps.repository.authenticateAllowedUser,
            getSessionByToken: deps.repository.getSessionByToken,
            now: () => (deps.now ?? (() => new Date()))().getTime(),
          },
          { allowUser: true, allowSession: false },
        )) as UserAuthContext;
        return await sessionStatusAction(body, auth, deps);
      }

      if (action === "apply_rows") {
        const auth = await resolveAuth(
          req,
          {
            authenticateAllowedUser: deps.repository.authenticateAllowedUser,
            getSessionByToken: deps.repository.getSessionByToken,
            now: () => (deps.now ?? (() => new Date()))().getTime(),
          },
          { allowUser: true, allowSession: true },
        );
        return await applyRowsAction(body, auth, deps);
      }

      if (action === "complete_session") {
        const auth = await resolveAuth(
          req,
          {
            authenticateAllowedUser: deps.repository.authenticateAllowedUser,
            getSessionByToken: deps.repository.getSessionByToken,
            now: () => (deps.now ?? (() => new Date()))().getTime(),
          },
          { allowUser: true, allowSession: true },
        );
        return await completeSessionAction(body, auth, deps);
      }

      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = isUnauthorizedError(message) ? 401 : 400;
      return jsonResponse({ error: message }, status);
    }
  };
}

const defaultDeps = createDefaultMoneyImportDeps();

export const handleRequest = createMoneyImportHandler(defaultDeps);
