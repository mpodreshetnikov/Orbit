import { corsHeaders } from "../_shared/cors.ts";
import {
  buildEdgePropagationHeaders,
  createEdgeRequestContext,
  createEdgeTelemetry,
} from "../_shared/observability.ts";
import { createDefaultHealthOcrDeps, type HealthOcrDeps } from "./deps.ts";
import { acceptHealthOcrRequest } from "./service.ts";
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
  /**
   * Keep the transcription alive after the response is sent. The platform's own
   * `EdgeRuntime.waitUntil` is what stops the worker being torn down with the request; tests
   * substitute something they can await.
   */
  runInBackground?: (work: Promise<unknown>) => void;
}

interface EdgeRuntimeWithWaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Hand the work to the runtime and stop watching it.
 *
 * A rejection here is not a response anyone is waiting for -- the service has already written the
 * failure to the record -- but an unhandled rejection would take the worker down with it, so it
 * is caught and logged.
 */
function dispatchInBackground(work: Promise<unknown>, log: Pick<Console, "log" | "error">): void {
  const settled = work.catch((error) => {
    log.error("[health-ocr] background work failed:", error);
  });
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeWithWaitUntil }).EdgeRuntime;
  runtime?.waitUntil?.(settled);
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
    const log = deps.log ?? console;
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

      const acceptance = await acceptHealthOcrRequest(
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

      if (acceptance.work) {
        // The response goes out now; the document is transcribed after it. Nothing downstream
        // reads this request's body for the result -- the record's status carries it.
        const runInBackground =
          deps.runInBackground ?? ((work: Promise<unknown>) => dispatchInBackground(work, log));
        runInBackground(acceptance.work());
      }

      telemetry.info("health_ocr_invocation_completed", {
        status_code: acceptance.status,
        has_record_id: recordId !== null,
        accepted: Boolean(acceptance.work),
      });
      await requestSpan.end({
        status: acceptance.status >= 400 ? "error" : "ok",
        attrs: {
          status_code: acceptance.status,
          has_record_id: recordId !== null,
          accepted: Boolean(acceptance.work),
        },
      });

      return new Response(JSON.stringify(acceptance.payload), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ...buildEdgePropagationHeaders(context, requestSpan.spanId),
        },
        status: acceptance.status,
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
