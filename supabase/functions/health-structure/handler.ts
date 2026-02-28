import { corsHeaders } from "../_shared/cors.ts";
import { createEdgeLogEvent, logEdgeEvent } from "../_shared/observability.ts";
import { createDefaultHealthStructureDeps, type HealthStructureDeps } from "./deps.ts";
import { runHealthStructureService } from "./service.ts";

export interface HealthStructureHandlerDeps extends HealthStructureDeps {}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const requestId = req.headers.get("x-request-id") ?? `health_structure_${crypto.randomUUID()}`;
    const emit = (
      level: "debug" | "info" | "warn" | "error",
      message: string,
      attrs?: Record<string, boolean | number | string | null>,
    ) => {
      logEdgeEvent(
        createEdgeLogEvent(level, message, {
          component: "health-structure",
          requestId,
          attrs,
        }),
      );
    };

    emit("info", "health_structure_invocation_started", {
      request_method: req.method,
    });

    if (req.method !== "POST") {
      emit("warn", "health_structure_method_not_allowed", {
        request_method: req.method,
      });
      return jsonResponse({ success: false, error: "Method not allowed" }, 405);
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
        },
      );

      emit("info", "health_structure_invocation_completed", {
        status_code: result.status,
        has_record_id: recordId !== null,
      });

      return jsonResponse(result.payload, result.status);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      emit("error", "health_structure_invocation_failed", {
        error_message: errorMessage,
      });

      return jsonResponse(
        {
          success: false,
          error: errorMessage,
        },
        400,
      );
    }
  };
}

const defaultDeps = createDefaultHealthStructureDeps();

export const handleRequest = createHealthStructureHandler(defaultDeps);
