import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildEdgePropagationHeaders,
  createEdgeRequestContext,
  createEdgeTelemetry,
} from "../_shared/observability.ts";
import {
  createSupabaseHealthStructureRepository,
  type HealthStructureRepository,
} from "../health-structure/repository.ts";
import { runHealthStructureService } from "../health-structure/service.ts";
import {
  type ClientSubmission,
  parseClientSubmission,
} from "../health-structure/stages/client-parse.ts";

/**
 * Ingest a document the owner's Claude read itself (ADR-261021-z02, T-260914-6n1).
 *
 * The caller — Orbit's MCP route, on behalf of a connected user, with that user's JWT — brings the
 * text it transcribed from the pages and what it extracted from them. Nothing here calls a model:
 * the submission stands in for the model stages, and `runHealthStructureService` then runs exactly
 * what it runs for the server pipeline — authentication, the processing claim, catalogue
 * resolution, unit conversion, the applied/issue split and the closure gates — and writes the
 * record the same way. Re-sending a submission for the same record replaces what the last one wrote.
 */
export interface HealthIngestDeps {
  repository: HealthStructureRepository | null;
  /**
   * Whether the caller's own token can read the record. The service runs on the service role once
   * the caller is authenticated, so this is what keeps the record's RLS deciding who may ingest
   * into it, as it decides what the caller sees in the browser.
   */
  canReadRecord: (token: string, recordId: string) => Promise<boolean>;
  log?: Pick<Console, "log" | "warn" | "error">;
}

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
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function createHealthIngestHandler(deps: HealthIngestDeps) {
  return async function handleHealthIngestRequest(req: Request): Promise<Response> {
    const context = createEdgeRequestContext(req, "health-ingest");
    const telemetry = createEdgeTelemetry(context);
    const requestSpan = telemetry.startSpan("edge.health_ingest.request", {
      kind: "server",
      attrs: { request_method: req.method },
    });
    const headers = () => buildEdgePropagationHeaders(context, requestSpan.spanId);

    if (req.method === "OPTIONS") {
      await requestSpan.end({ status: "ok", attrs: { cors_preflight: true } });
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      await requestSpan.end({ status: "error", statusMessage: "Method not allowed" });
      return jsonResponse({ success: false, error: "Method not allowed" }, 405, headers());
    }

    try {
      if (!deps.repository) throw new Error("Supabase environment not configured");

      const body = asBody(await req.json());
      const recordId = typeof body.record_id === "string" ? body.record_id : null;
      const documentText = typeof body.source_text === "string" ? body.source_text.trim() : "";
      // Checked before the service runs, so a malformed call never takes the record's claim or
      // stamps a structure_error on it.
      if (!documentText) throw new Error("Missing required field: source_text");
      // A truncated call must not replace the record's contents with defaults and empty lists.
      for (const field of ["classification", "extraction"] as const) {
        if (!body[field] || typeof body[field] !== "object" || Array.isArray(body[field])) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
      const token = getBearerToken(req);
      if (token && recordId && !(await deps.canReadRecord(token, recordId))) {
        throw new Error("Record not found or access denied");
      }
      const submission: ClientSubmission = {
        classification: body.classification,
        extraction: body.extraction,
        reconciliation: body.reconciliation,
      };

      const result = await runHealthStructureService(
        { authToken: token, recordId, documentText },
        {
          repository: deps.repository,
          parseStructuredData: (text, parseContext) =>
            Promise.resolve(parseClientSubmission(submission, text, parseContext)),
          log: deps.log,
          telemetry,
        },
      );

      await requestSpan.end({
        status: result.status >= 400 ? "error" : "ok",
        attrs: { status_code: result.status, has_record_id: recordId !== null },
      });
      return jsonResponse(result.payload, result.status, headers());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      telemetry.error("health_ingest_invocation_failed", { error_message: errorMessage });
      await requestSpan.end({ status: "error", statusMessage: errorMessage });
      return jsonResponse({ success: false, error: errorMessage }, 400, headers());
    }
  };
}

function createDefaultRepository(): HealthStructureRepository | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  return createSupabaseHealthStructureRepository({ supabaseUrl, supabaseServiceRoleKey });
}

async function canReadRecordWithUserToken(token: string, recordId: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) throw new Error("Supabase environment not configured");
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client
    .from("medical_records")
    .select("id")
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(`Failed to check access to the record: ${error.message}`);
  return data !== null;
}

export const handleRequest = createHealthIngestHandler({
  repository: createDefaultRepository(),
  canReadRecord: canReadRecordWithUserToken,
});
