import { corsHeaders } from "../_shared/cors.ts";
import { createEdgeRequestContext, createEdgeTelemetry } from "../_shared/observability.ts";
import { createDefaultMoneyCategorizeDeps } from "./deps.ts";
import {
  applyMoneyCategoryRulePipelineService,
  previewMoneyCategoryRulePipelineService,
  replayMoneyCategoryRulePipelineForDateRangeService,
  replayMoneyCategoryRulePipelineForTransactionService,
} from "./service.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function asBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createMoneyCategorizeHandler(deps = createDefaultMoneyCategorizeDeps()) {
  return async function handleMoneyCategorizeRequest(req: Request): Promise<Response> {
    const context = createEdgeRequestContext(req, "money-categorize");
    const telemetry = createEdgeTelemetry(context);

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const token = getBearerToken(req);
      if (!token) return jsonResponse({ error: "Missing Authorization header" }, 401);

      const user = await deps.authenticateAllowedUser(token);
      if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

      const body = asBody(await req.json().catch(() => ({})));
      const action = normalizeText(body.action);
      if (!action) return jsonResponse({ error: "action is required" }, 400);

      telemetry.info("money_categorize_action_received", { action });

      if (action === "preview_pipeline") {
        const payload = await previewMoneyCategoryRulePipelineService(
          {
            lineItemId: String(body.line_item_id ?? ""),
            personId: normalizeText(body.person_id),
            ruleIds: Array.isArray(body.rule_ids)
              ? body.rule_ids.filter((item): item is string => typeof item === "string")
              : null,
          },
          deps,
        );
        return jsonResponse(payload, 200);
      }

      if (action === "apply_pipeline") {
        const payload = await applyMoneyCategoryRulePipelineService(
          {
            lineItemIds: Array.isArray(body.line_item_ids)
              ? body.line_item_ids.filter((item): item is string => typeof item === "string")
              : [],
            personId: String(body.person_id ?? ""),
            forceOverwriteLocked: Boolean(body.force_overwrite_locked),
            triggerSource: normalizeText(body.trigger_source) ?? "manual_replay",
            triggeredByUserId: user.userId,
          },
          deps,
        );
        return jsonResponse(payload, 200);
      }

      if (action === "replay_transaction") {
        const payload = await replayMoneyCategoryRulePipelineForTransactionService(
          {
            transactionId: String(body.transaction_id ?? ""),
            personId: String(body.person_id ?? ""),
            forceOverwriteLocked: Boolean(body.force_overwrite_locked),
            triggeredByUserId: user.userId,
          },
          deps,
        );
        return jsonResponse(payload, 200);
      }

      if (action === "replay_date_range") {
        const payload = await replayMoneyCategoryRulePipelineForDateRangeService(
          {
            personId: String(body.person_id ?? ""),
            from: String(body.from ?? ""),
            to: String(body.to ?? ""),
            forceOverwriteLocked: Boolean(body.force_overwrite_locked),
            triggeredByUserId: user.userId,
          },
          deps,
        );
        return jsonResponse(payload, 200);
      }

      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      telemetry.error("money_categorize_action_failed", { error_message: message });
      return jsonResponse({ error: message }, 400);
    }
  };
}

export const handleRequest = createMoneyCategorizeHandler();
