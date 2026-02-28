import { corsHeaders } from "../_shared/cors.ts";
import { createEdgeLogEvent, logEdgeEvent } from "../_shared/observability.ts";
import { createDefaultIcdLookupDeps, type IcdLookupDeps } from "./deps.ts";
import { runIcdLookupService } from "./service.ts";

export interface IcdLookupHandlerDeps {
  whoClient: IcdLookupDeps["whoClient"];
}

export function createIcdLookupHandler(deps: IcdLookupHandlerDeps) {
  return async function handleIcdLookupRequest(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const requestId = req.headers.get("x-request-id") ?? `icd_lookup_${crypto.randomUUID()}`;
    const emit = (
      level: "debug" | "info" | "warn" | "error",
      message: string,
      attrs?: Record<string, boolean | number | string | null>,
    ) => {
      logEdgeEvent(
        createEdgeLogEvent(level, message, {
          component: "icd-lookup",
          requestId,
          attrs,
        }),
      );
    };

    emit("info", "icd_lookup_invocation_started", {
      request_method: req.method,
    });

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    emit("debug", "icd_lookup_payload_parsed", {
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
      });

      emit("info", "icd_lookup_invocation_completed", {
        status_code: result.status,
      });

      return new Response(JSON.stringify(result.payload), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      emit("error", "icd_lookup_invocation_failed", {
        error_message: errorMessage,
      });
      throw error;
    }
  };
}

const defaultDeps = createDefaultIcdLookupDeps();

export const handleRequest = createIcdLookupHandler(defaultDeps);
