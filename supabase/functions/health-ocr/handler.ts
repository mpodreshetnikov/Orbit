import { corsHeaders } from "../_shared/cors.ts";
import {
  buildEdgePropagationHeaders,
  createEdgeRequestContext,
  createEdgeTelemetry,
} from "../_shared/observability.ts";
import { createDefaultHealthOcrDeps, type HealthOcrDeps } from "./deps.ts";
import { runHealthOcrService } from "./service.ts";
import type { HealthOcrRepository } from "./repository.ts";

export interface HealthOcrHandlerDeps {
  config: HealthOcrDeps["config"];
  maxAttachmentBytes: number;
  maxOcrErrorLength: number;
  defaultTitle: string;
  createRepository: (authToken: string) => HealthOcrRepository;
  openRouterClient: HealthOcrDeps["openRouterClient"];
  log?: Pick<Console, "log" | "error">;
  now?: () => number;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  return authHeader.replace("Bearer ", "");
}

export function createHealthOcrHandler(deps: HealthOcrHandlerDeps) {
  return async function handleHealthOcrRequest(req: Request): Promise<Response> {
    const context = createEdgeRequestContext(req, "health-ocr");
    const telemetry = createEdgeTelemetry(context);
    const requestSpan = telemetry.startSpan("edge.health_ocr.request", {
      kind: "server",
      attrs: {
        request_method: req.method,
      },
    });

    if (req.method === "OPTIONS") {
      await requestSpan.end({ status: "ok", attrs: { cors_preflight: true } });
      return new Response("ok", { headers: corsHeaders });
    }

    telemetry.info("health_ocr_invocation_started", {
      request_method: req.method,
    });

    try {
      if (!deps.config.openRouterApiKey || !deps.openRouterClient) {
        throw new Error("OPENROUTER_API_KEY not configured");
      }
      if (!deps.config.supabaseUrl || !deps.config.supabaseServiceRoleKey) {
        throw new Error("Supabase environment not configured");
      }

      const token = getBearerToken(req);
      if (!token) {
        throw new Error("Missing authorization header");
      }

      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }

      const recordId = typeof body.record_id === "string" ? body.record_id : null;
      const repository = deps.createRepository(token);

      const result = await runHealthOcrService(
        {
          authToken: token,
          recordId,
        },
        {
          repository,
          openRouterClient: deps.openRouterClient,
          maxAttachmentBytes: deps.maxAttachmentBytes,
          maxOcrErrorLength: deps.maxOcrErrorLength,
          defaultTitle: deps.defaultTitle,
          log: deps.log,
          now: deps.now,
          telemetry,
        },
      );

      telemetry.info("health_ocr_invocation_completed", {
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

      return new Response(JSON.stringify(result.payload), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ...buildEdgePropagationHeaders(context, requestSpan.spanId),
        },
        status: result.status,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      telemetry.error("health_ocr_invocation_failed", {
        error_message: errorMessage,
      });
      await requestSpan.end({
        status: "error",
        statusMessage: errorMessage,
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            ...buildEdgePropagationHeaders(context, requestSpan.spanId),
          },
          status: 400,
        },
      );
    }
  };
}

const defaultDeps = createDefaultHealthOcrDeps();

export const handleRequest = createHealthOcrHandler(defaultDeps);
