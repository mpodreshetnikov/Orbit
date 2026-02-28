import { corsHeaders } from "../_shared/cors.ts";
import {
  buildEdgePropagationHeaders,
  createEdgeRequestContext,
  createEdgeTelemetry,
} from "../_shared/observability.ts";
import { createDefaultIcdLookupDeps, type IcdLookupDeps } from "./deps.ts";
import { runIcdLookupService } from "./service.ts";

export interface IcdLookupHandlerDeps {
  whoClient: IcdLookupDeps["whoClient"];
}

export function createIcdLookupHandler(deps: IcdLookupHandlerDeps) {
  return async function handleIcdLookupRequest(req: Request): Promise<Response> {
    const context = createEdgeRequestContext(req, "icd-lookup");
    const telemetry = createEdgeTelemetry(context);
    const requestSpan = telemetry.startSpan("edge.icd_lookup.request", {
      kind: "server",
      attrs: {
        request_method: req.method,
      },
    });

    if (req.method === "OPTIONS") {
      await requestSpan.end({ status: "ok", attrs: { cors_preflight: true } });
      return new Response("ok", { headers: corsHeaders });
    }

    telemetry.info("icd_lookup_invocation_started", {
      request_method: req.method,
    });

    let body: unknown = {};
    try {
      const parseSpan = telemetry.startSpan("edge.icd_lookup.parse_payload");
      body = await req.json();
      await parseSpan.end({ status: "ok" });
    } catch {
      body = {};
    }

    telemetry.debug("icd_lookup_payload_parsed", {
      has_code: Boolean(
        body &&
        typeof body === "object" &&
        "code" in body &&
        typeof (body as { code?: unknown }).code === "string",
      ),
      has_search: Boolean(
        body &&
        typeof body === "object" &&
        "search" in body &&
        typeof (body as { search?: unknown }).search === "string",
      ),
    });

    try {
      const result = await runIcdLookupService(body, {
        whoClient: deps.whoClient,
        telemetry,
      });

      telemetry.info("icd_lookup_invocation_completed", {
        status_code: result.status,
      });
      await requestSpan.end({
        status: result.status >= 400 ? "error" : "ok",
        attrs: {
          status_code: result.status,
        },
      });

      return new Response(JSON.stringify(result.payload), {
        status: result.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ...buildEdgePropagationHeaders(context, requestSpan.spanId),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      telemetry.error("icd_lookup_invocation_failed", {
        error_message: errorMessage,
      });
      await requestSpan.end({
        status: "error",
        statusMessage: errorMessage,
      });
      throw error;
    }
  };
}

const defaultDeps = createDefaultIcdLookupDeps();

export const handleRequest = createIcdLookupHandler(defaultDeps);
