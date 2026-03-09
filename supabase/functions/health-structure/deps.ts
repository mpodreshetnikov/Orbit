import { callOpenRouterParse } from "./openrouter-parse.ts";
import { parseStructuredDataE2EStub } from "./e2e-stub-parse.ts";
import {
  createSupabaseHealthStructureRepository,
  type HealthStructureRepository,
} from "./repository.ts";
import type { HealthStructureParseContext } from "./service.ts";
import type { IcdLookupResult, StructuredDataWithEntities } from "./types.ts";

export type HealthStructureParserMode = "openrouter" | "e2e_stub";

export interface HealthStructureDeps {
  config: {
    openRouterApiKey?: string;
    supabaseUrl?: string;
    supabaseServiceRoleKey?: string;
    openRouterModel?: string;
    openRouterTimeoutMs?: number;
    parseMode?: HealthStructureParserMode;
  };
  repository: HealthStructureRepository;
  parseStructuredData: (
    ocrText: string,
    context: HealthStructureParseContext,
  ) => Promise<StructuredDataWithEntities>;
  lookupIcdCode: (code: string) => Promise<IcdLookupResult | null>;
  log?: Pick<Console, "log" | "warn" | "error">;
}

function createMissingEnvRepository(): HealthStructureRepository {
  const fail = (): Promise<never> => {
    throw new Error("Supabase environment not configured");
  };
  return {
    authenticateAllowedUser: () => Promise.resolve(null),
    getRecord: fail,
    fetchObservationCatalog: fail,
    fetchFindingTypeCatalog: fail,
    fetchBodySiteCatalog: fail,
    fetchPersonConditions: fail,
    fetchPersonActiveFindings: fail,
    fetchUpcomingOverdueCheckupItems: fail,
    updateMedicalRecord: fail,
    replaceRecordObservations: fail,
    replaceRecordFindings: fail,
    clearConditionRecords: fail,
    findConditionByIcd: fail,
    findConditionByName: fail,
    createCondition: fail,
    updateCondition: fail,
    insertConditionRecord: fail,
    recomputeConditionCurrentStatus: fail,
    insertFinding: fail,
  } as unknown as HealthStructureRepository;
}

export function createDefaultHealthStructureDeps(): HealthStructureDeps {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openRouterModel =
    Deno.env.get("OPENROUTER_HEALTH_STRUCTURE_MODEL") ?? "openai/gpt-5.2:nitro";
  const openRouterTimeoutRaw = Deno.env.get("OPENROUTER_HEALTH_STRUCTURE_TIMEOUT_MS");
  const openRouterTimeoutMs =
    openRouterTimeoutRaw && Number.isFinite(Number(openRouterTimeoutRaw))
      ? Number(openRouterTimeoutRaw)
      : undefined;
  const rawParseMode = Deno.env.get("HEALTH_STRUCTURE_PARSER_MODE");
  const parseMode: HealthStructureParserMode =
    rawParseMode === "e2e_stub" ? "e2e_stub" : "openrouter";
  const hasSupabaseEnv = Boolean(supabaseUrl && supabaseServiceRoleKey);

  return {
    config: {
      openRouterApiKey: openRouterApiKey ?? undefined,
      supabaseUrl: supabaseUrl ?? undefined,
      supabaseServiceRoleKey: supabaseServiceRoleKey ?? undefined,
      openRouterModel,
      openRouterTimeoutMs,
      parseMode,
    },
    repository: hasSupabaseEnv
      ? createSupabaseHealthStructureRepository({
          supabaseUrl: supabaseUrl ?? undefined,
          supabaseServiceRoleKey: supabaseServiceRoleKey ?? undefined,
        })
      : createMissingEnvRepository(),
    parseStructuredData: async (ocrText, context) => {
      if (parseMode === "e2e_stub") {
        return await parseStructuredDataE2EStub(ocrText, context);
      }
      if (!openRouterApiKey) {
        throw new Error("OPENROUTER_API_KEY is required");
      }
      return await callOpenRouterParse(ocrText, context, {
        fetchFn: globalThis.fetch,
        apiKey: openRouterApiKey,
        model: openRouterModel,
        timeoutMs: openRouterTimeoutMs,
      });
    },
    lookupIcdCode: async (code) => {
      if (!supabaseUrl || !supabaseServiceRoleKey) return null;
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/icd-lookup`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseServiceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) return null;
        return (await response.json()) as IcdLookupResult;
      } catch {
        return null;
      }
    },
  };
}
