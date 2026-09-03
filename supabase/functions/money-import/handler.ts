import { corsHeaders } from "../_shared/cors.ts";
import { createEdgeRequestContext, createEdgeTelemetry } from "../_shared/observability.ts";
import { type MoneyImportAuthDeps, resolveAuth } from "./auth.ts";
import { applyRowsAction } from "./apply-rows.ts";
import { applyBatchAction } from "./apply-batch.ts";
import { createDefaultMoneyImportDeps, type MoneyImportDeps } from "./deps.ts";
import { discardBatchAction } from "./discard-batch.ts";
import { getExistingTransactionStatesAction } from "./existing-transaction-states.ts";
import { jsonResponse, normalizeText } from "./normalize.ts";
import { previewRowsAction } from "./preview-rows.ts";
import { remapPreviewCardAction } from "./preview-batch-actions.ts";
import { updateBrandResolutionAction } from "./update-brand-resolution.ts";
import {
  completeSessionAction,
  createSessionAction,
  getImportContextAction,
  sessionStatusAction,
} from "./session-actions.ts";
import type { GrantAuthContext, SessionAuthContext, UserAuthContext } from "./types.ts";

export interface MoneyImportHandlerDeps extends MoneyImportDeps {}

function asBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function isUnauthorizedError(message: string): boolean {
  return message === "Unauthorized" || message.includes("Authorization");
}

export function createMoneyImportHandler(deps: MoneyImportHandlerDeps) {
  // One set of auth dependencies for every action, so a session minted by a grant is re-checked
  // against that grant on every call -- not only on the actions somebody remembered to wire.
  // `resolveAuth` fails closed without the grant lookup, so an action that built its own,
  // shorter set would refuse every unattended session rather than wave one through.
  const authDeps: MoneyImportAuthDeps = {
    authenticateAllowedUser: deps.repository.authenticateAllowedUser,
    getSessionByToken: deps.repository.getSessionByToken,
    getGrantById: deps.repository.getGrantById,
    isAuthUserAllowed: deps.repository.isAuthUserAllowed,
    now: () => (deps.now ?? (() => new Date()))().getTime(),
  };

  return async function handleMoneyImportRequest(req: Request): Promise<Response> {
    const context = createEdgeRequestContext(req, "money-import");
    const telemetry = createEdgeTelemetry(context);
    const requestSpan = telemetry.startSpan("edge.money_import.request", {
      kind: "server",
      attrs: {
        request_method: req.method,
      },
    });

    if (req.method === "OPTIONS") {
      await requestSpan.end({ status: "ok", attrs: { cors_preflight: true } });
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      telemetry.warn("money_import_method_not_allowed", {
        request_method: req.method,
      });
      await requestSpan.end({
        status: "error",
        statusMessage: "Method not allowed",
      });
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
      telemetry.warn("money_import_missing_action");
      await requestSpan.end({
        status: "error",
        statusMessage: "action is required",
      });
      return jsonResponse({ error: "action is required" }, 400);
    }
    telemetry.info("money_import_action_received", {
      action,
    });

    try {
      if (action === "create_session") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.create_session");
        // The one action a grant may perform. Everything after it runs on the short-lived
        // session token this hands back.
        const auth = (await resolveAuth(
          req,
          { ...authDeps, getGrantByToken: deps.repository.getGrantByToken },
          { allowUser: true, allowSession: false, allowGrant: true },
        )) as UserAuthContext | GrantAuthContext;
        const response = await createSessionAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "get_import_context") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.get_import_context");
        const auth = (await resolveAuth(req, authDeps, {
          allowUser: true,
          allowSession: false,
        })) as UserAuthContext;
        const response = await getImportContextAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "get_existing_transaction_states") {
        const actionSpan = telemetry.startSpan(
          "edge.money_import.action.get_existing_transaction_states",
        );
        // A session token may ask; the action pins the question to the session's own import.
        const auth = (await resolveAuth(req, authDeps, {
          allowUser: true,
          allowSession: true,
        })) as UserAuthContext | SessionAuthContext;
        const response = await getExistingTransactionStatesAction(body, auth, {
          ...deps,
          telemetry,
        });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "session_status") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.session_status");
        const auth = (await resolveAuth(req, authDeps, {
          allowUser: true,
          allowSession: false,
        })) as UserAuthContext;
        const response = await sessionStatusAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "apply_rows") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.apply_rows");
        const auth = await resolveAuth(req, authDeps, { allowUser: true, allowSession: true });
        const response = await applyRowsAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "preview_rows") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.preview_rows");
        const auth = await resolveAuth(req, authDeps, { allowUser: true, allowSession: true });
        const response = await previewRowsAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "apply_batch") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.apply_batch");
        const auth = (await resolveAuth(req, authDeps, {
          allowUser: true,
          allowSession: false,
        })) as UserAuthContext;
        const response = await applyBatchAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "discard_batch") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.discard_batch");
        const auth = (await resolveAuth(req, authDeps, {
          allowUser: true,
          allowSession: false,
        })) as UserAuthContext;
        const response = await discardBatchAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "update_brand_resolution") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.update_brand_resolution");
        const auth = (await resolveAuth(req, authDeps, {
          allowUser: true,
          allowSession: false,
        })) as UserAuthContext;
        const response = await updateBrandResolutionAction(body, auth, {
          repository: deps.repository,
        });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "remap_preview_card") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.remap_preview_card");
        const auth = (await resolveAuth(req, authDeps, {
          allowUser: true,
          allowSession: false,
        })) as UserAuthContext;
        const response = await remapPreviewCardAction(body, auth, {
          repository: deps.repository,
        });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      if (action === "complete_session") {
        const actionSpan = telemetry.startSpan("edge.money_import.action.complete_session");
        const auth = await resolveAuth(req, authDeps, { allowUser: true, allowSession: true });
        const response = await completeSessionAction(body, auth, { ...deps, telemetry });
        await actionSpan.end({ status: "ok" });
        await requestSpan.end({
          status: response.status >= 400 ? "error" : "ok",
          attrs: { action, status_code: response.status },
        });
        return response;
      }

      telemetry.warn("money_import_unknown_action", { action });
      await requestSpan.end({
        status: "error",
        statusMessage: `Unknown action: ${action}`,
      });
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = isUnauthorizedError(message) ? 401 : 400;
      telemetry.error("money_import_action_failed", {
        action,
        error_message: message,
      });
      await requestSpan.end({
        status: "error",
        statusMessage: message,
        attrs: {
          action,
          status_code: status,
        },
      });
      return jsonResponse({ error: message }, status);
    }
  };
}

const defaultDeps = createDefaultMoneyImportDeps();

export const handleRequest = createMoneyImportHandler(defaultDeps);
