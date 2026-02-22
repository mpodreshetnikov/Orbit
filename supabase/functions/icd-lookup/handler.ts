import { corsHeaders } from "../_shared/cors.ts";
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

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const result = await runIcdLookupService(body, {
      whoClient: deps.whoClient,
    });

    return new Response(JSON.stringify(result.payload), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };
}

const defaultDeps = createDefaultIcdLookupDeps();

export const handleRequest = createIcdLookupHandler(defaultDeps);
