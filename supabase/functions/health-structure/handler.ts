import { corsHeaders } from "../_shared/cors.ts";
import {
  buildEdgePropagationHeaders,
  createEdgeRequestContext,
  createEdgeTelemetry,
} from "../_shared/observability.ts";
import { createDefaultHealthStructureDeps, type HealthStructureDeps } from "./deps.ts";
import { runHealthStructureService } from "./service.ts";

export interface HealthStructureHandlerDeps extends HealthStructureDeps {}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function asBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

export function createHealthStructureHandler(deps: HealthStructureHandlerDeps) {
  return async function handleHealthStructureRequest(req: Request): Promise<Response> {
    const context = createEdgeRequestContext(req, "health-structure");
    const telemetry = createEdgeTelemetry(context);
    const requestSpan = telemetry.startSpan("edge.health_structure.request", {
      kind: "server",
      attrs: {
        request_method: req.method,
      },
    });

    if (req.method === "OPTIONS") {
      await requestSpan.end({ status: "ok", attrs: { cors_preflight: true } });
      return new Response("ok", { headers: corsHeaders });
    }

    telemetry.info("health_structure_invocation_started", {
      request_method: req.method,
    });

    if (req.method !== "POST") {
      telemetry.warn("health_structure_method_not_allowed", {
        request_method: req.method,
      });
      await requestSpan.end({
        status: "error",
        statusMessage: "Method not allowed",
      });
      return jsonResponse(
        { success: false, error: "Method not allowed" },
        405,
        buildEdgePropagationHeaders(context, requestSpan.spanId),
      );
    }

    try {
      if (!deps.config.openRouterApiKey) {
        throw new Error("OPENROUTER_API_KEY is required");
      }
      if (!deps.config.supabaseUrl || !deps.config.supabaseServiceRoleKey) {
        throw new Error("Supabase environment not configured");
      }

      const token = getBearerToken(req);
      const body = asBody(await req.json());
      const recordId = typeof body.record_id === "string" ? body.record_id : null;

      const result = await runHealthStructureService(
        {
          authToken: token,
          recordId,
        },
        {
          repository: deps.repository,
          parseStructuredData: deps.parseStructuredData,
          lookupIcdCode: deps.lookupIcdCode,
          log: deps.log,
          telemetry,
        },
      );

      telemetry.info("health_structure_invocation_completed", {
        status_code: result.status,
        has_record_id: recordId !== null,
      });
      await requestSpan.end({
        status: result.status >= 400 ? "error" : "ok",
        attrs: {
          status_code: result.status,
          has_record_id: recordId !== null,
        },
      });

      return jsonResponse(
        result.payload,
        result.status,
        buildEdgePropagationHeaders(context, requestSpan.spanId),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      telemetry.error("health_structure_invocation_failed", {
        error_message: errorMessage,
      });
      await requestSpan.end({
        status: "error",
        statusMessage: errorMessage,
      });

      return jsonResponse(
        {
          success: false,
          error: errorMessage,
        },
        400,
        buildEdgePropagationHeaders(context, requestSpan.spanId),
      );
    }
  };
}

const defaultDeps = createDefaultHealthStructureDeps();

export const handleRequest = createHealthStructureHandler(defaultDeps);
