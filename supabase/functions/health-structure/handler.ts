import { corsHeaders } from "../_shared/cors.ts";
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

    if (req.method !== "POST") {
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

      return jsonResponse(result.payload, result.status);
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        400,
      );
    }
  };
}

const defaultDeps = createDefaultHealthStructureDeps();

export const handleRequest = createHealthStructureHandler(defaultDeps);
