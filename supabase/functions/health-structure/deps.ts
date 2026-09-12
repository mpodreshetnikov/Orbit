import { callOpenRouterParse } from "./openrouter-parse.ts";
import { runStagedParse } from "./stages/index.ts";
import { preprocessOcrImage } from "../_shared/image-preprocess.ts";
import { parseStructuredDataE2EStub } from "./e2e-stub-parse.ts";
import { loadRecordPageImages } from "./page-images.ts";
import {
  createSupabaseHealthStructureRepository,
  type HealthStructureRepository,
} from "./repository.ts";
import type { HealthStructureParseContext } from "./service.ts";
import { emptyLlmUsage } from "../_shared/llm-usage.ts";
import { DEFAULT_OPENROUTER_MODEL } from "../_shared/llm-model.ts";
import type { StructuredParseOutcome } from "./types.ts";

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
  ) => Promise<StructuredParseOutcome>;
  /** Load the record's pages for the extraction stage; absent when there is nothing to load. */
  loadPageImages?: (recordId: string) => Promise<string[]>;
  log?: Pick<Console, "log" | "warn" | "error">;
}

function createMissingEnvRepository(): HealthStructureRepository {
  const fail = (): Promise<never> => {
    throw new Error("Supabase environment not configured");
  };
  return {
    authenticateAllowedUser: () => Promise.resolve(null),
    getRecord: fail,
    getAttachments: fail,
    downloadAttachment: fail,
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
    Deno.env.get("OPENROUTER_HEALTH_STRUCTURE_MODEL") ?? DEFAULT_OPENROUTER_MODEL;
  // Per-stage overrides. Extraction is accuracy-critical and deserves the strongest model;
  // classification and reconciliation are cheaper jobs and can be pointed at a smaller one.
  // Each falls back to the shared default so an unset environment keeps working.
  const stageModels = {
    classify: Deno.env.get("OPENROUTER_HEALTH_STAGE_CLASSIFY_MODEL") ?? undefined,
    extract: Deno.env.get("OPENROUTER_HEALTH_STAGE_EXTRACT_MODEL") ?? undefined,
    reconcile: Deno.env.get("OPENROUTER_HEALTH_STAGE_RECONCILE_MODEL") ?? undefined,
  };
  // The staged pipeline is the default. Set to "monolithic" to fall back to the single-call
  // parser during rollout.
  const pipelineMode =
    Deno.env.get("HEALTH_STRUCTURE_PIPELINE_MODE") === "monolithic" ? "monolithic" : "staged";
  // Comma-separated, tried in order after the primary when it is unavailable.
  const fallbackModels = (Deno.env.get("OPENROUTER_HEALTH_STRUCTURE_FALLBACK_MODELS") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const openRouterTimeoutRaw = Deno.env.get("OPENROUTER_HEALTH_STRUCTURE_TIMEOUT_MS");
  const openRouterTimeoutMs =
    openRouterTimeoutRaw && Number.isFinite(Number(openRouterTimeoutRaw))
      ? Number(openRouterTimeoutRaw)
      : undefined;
  // Escape hatch for local debugging only. The raw model answer contains patient data, so
  // this must never be set in a deployed environment. Anything other than an exact "true"
  // leaves it off.
  const debugRawPayload = Deno.env.get("HEALTH_STRUCTURE_DEBUG_RAW_PAYLOAD") === "true";
  const rawParseMode = Deno.env.get("HEALTH_STRUCTURE_PARSER_MODE");
  const parseMode: HealthStructureParserMode =
    rawParseMode === "e2e_stub" ? "e2e_stub" : "openrouter";
  const hasSupabaseEnv = Boolean(supabaseUrl && supabaseServiceRoleKey);

  const repository = hasSupabaseEnv
    ? createSupabaseHealthStructureRepository({
        supabaseUrl: supabaseUrl ?? undefined,
        supabaseServiceRoleKey: supabaseServiceRoleKey ?? undefined,
      })
    : createMissingEnvRepository();

  return {
    config: {
      openRouterApiKey: openRouterApiKey ?? undefined,
      supabaseUrl: supabaseUrl ?? undefined,
      supabaseServiceRoleKey: supabaseServiceRoleKey ?? undefined,
      openRouterModel,
      openRouterTimeoutMs,
      parseMode,
    },
    repository,
    parseStructuredData: async (ocrText, context) => {
      if (parseMode === "e2e_stub") {
        return {
          structured: await parseStructuredDataE2EStub(ocrText, context),
          usage: emptyLlmUsage(),
          stagesRun: [],
        };
      }
      if (!openRouterApiKey) {
        throw new Error("OPENROUTER_API_KEY is required");
      }
      if (pipelineMode === "staged") {
        const outcome = await runStagedParse(ocrText, context, {
          fetchFn: globalThis.fetch,
          apiKey: openRouterApiKey,
          defaultModel: openRouterModel,
          models: stageModels,
          fallbackModels,
          timeoutMs: openRouterTimeoutMs,
          debugRawPayload,
          // The service supplies this once it holds the claim; without one the parse simply
          // does not renew, which is what the tests and the stub want.
          renewClaim: context.renewClaim,
        });
        if (outcome.rejected.length > 0) {
          // Counts and reasons only — reasons are fixed strings, never entity content.
          console.log(
            JSON.stringify({
              health_structure_stage_rejections: true,
              stages_run: outcome.stagesRun,
              rejected_count: outcome.rejected.length,
              reasons: outcome.rejected.map((item) => `${item.entityKind}:${item.reason}`),
            }),
          );
        }
        // Cost travels with the result so the service can put it on the record's own span.
        // It used to be a standalone log line, which carried no trace id and so could not be
        // read as per-record cost.
        return {
          structured: outcome.structured,
          usage: outcome.usage,
          stagesRun: outcome.stagesRun,
          issues: outcome.issues,
        };
      }
      const structured = await callOpenRouterParse(ocrText, context, {
        fetchFn: globalThis.fetch,
        apiKey: openRouterApiKey,
        model: openRouterModel,
        timeoutMs: openRouterTimeoutMs,
        debugRawPayload,
      });
      // The pre-staged parser never read the provider's usage object; it is kept only as the
      // fallback pipeline, so its cost stays unknown rather than being reported as zero.
      return { structured, usage: emptyLlmUsage(), stagesRun: [] };
    },
    // Only the staged pipeline reads them. The E2E stub structures from a marker in the text and
    // never calls a model, and the monolithic fallback is text-only -- downloading and decoding
    // four attachments for either would be latency and memory spent on nothing, and the
    // monolithic path is the rollout escape hatch, where that matters most.
    loadPageImages:
      parseMode === "e2e_stub" || pipelineMode !== "staged" || !hasSupabaseEnv
        ? undefined
        : (recordId: string) =>
            loadRecordPageImages(recordId, {
              getAttachments: (id) => repository.getAttachments(id),
              downloadAttachment: (path) => repository.downloadAttachment(path),
              preprocessImage: preprocessOcrImage,
              log: console,
            }),
  };
}
