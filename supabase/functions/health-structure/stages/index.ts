import { runClassifyStage } from "./classify.ts";
import { runExtractStage } from "./extract.ts";
import { hasNothingToReconcile, runReconcileStage } from "./reconcile.ts";
import { sumUsage, type StageContext, type StageRejection, type StageUsage } from "./types.ts";
import type { HealthStructureParseContext } from "../service.ts";
import type { StructuredDataWithEntities } from "../types.ts";

export interface StagedParseDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  /** Per-stage model overrides; each falls back to `defaultModel`. */
  models?: { classify?: string; extract?: string; reconcile?: string };
  defaultModel: string;
  /** Tried in order when the primary model is unavailable. */
  fallbackModels?: string[];
  timeoutMs?: number;
  maxAttempts?: number;
  sleepFn?: (ms: number) => Promise<void>;
  jitterFn?: () => number;
  log?: Pick<Console, "log" | "warn" | "error">;
  debugRawPayload?: boolean;
  /**
   * Tell the caller this run is still working, between stages.
   *
   * The whole parse is one claim, and three staged calls with retries and provider backoff can
   * run for many minutes. Without this the lease has to be long enough for the worst case, which
   * is the same as saying a dead structuring worker holds its record for an hour. Returning false
   * means the record has been taken over, and the run stops rather than paying for a result it
   * may not write.
   */
  renewClaim?: () => Promise<boolean>;
}

/** Thrown when a renewal reports the record now belongs to another run. */
export class StagedParseClaimLostError extends Error {
  constructor() {
    super("Another run owns this record");
    this.name = "StagedParseClaimLostError";
  }
}

export interface StagedParseOutcome {
  structured: StructuredDataWithEntities;
  usage: StageUsage;
  rejected: StageRejection[];
  stagesRun: string[];
}

function stageContext(deps: StagedParseDeps, model: string, effort?: StageContext["effort"]) {
  return {
    fetchFn: deps.fetchFn,
    apiKey: deps.apiKey,
    model,
    fallbackModels: deps.fallbackModels,
    effort,
    timeoutMs: deps.timeoutMs,
    maxAttempts: deps.maxAttempts,
    log: deps.log,
    debugRawPayload: deps.debugRawPayload,
    sleepFn: deps.sleepFn,
    jitterFn: deps.jitterFn,
  } satisfies StageContext;
}

/**
 * Run the staged structuring pipeline and assemble the legacy result shape.
 *
 * The stages are deliberately narrow and the sequence deliberately fixed:
 *
 *   A classify   — document text only
 *   B extract    — catalogue vocabulary + document text, never patient history
 *   D reconcile  — extracted entities + patient history, never document text
 *
 * Stage C (deterministic code resolution) runs downstream in the service, against the catalogues,
 * so it needs no model call and is not represented here.
 *
 * Classification and extraction are independent and run concurrently. Reconciliation depends on
 * extraction, so it follows, and is skipped when the patient has nothing to reconcile against.
 */
export async function runStagedParse(
  ocrText: string,
  context: HealthStructureParseContext,
  deps: StagedParseDeps,
): Promise<StagedParseOutcome> {
  const stagesRun: string[] = [];

  const [classify, extract] = await Promise.all([
    runClassifyStage(ocrText, stageContext(deps, deps.models?.classify ?? deps.defaultModel)),
    runExtractStage(
      ocrText,
      {
        observationCatalog: context.observationCatalog,
        findingTypeCatalog: context.findingTypeCatalog,
        bodySiteCatalog: context.bodySiteCatalog,
      },
      // Extraction is the accuracy-critical stage; it gets the higher reasoning budget, and the
      // pages themselves where the transcription of a table is ambiguous.
      stageContext(deps, deps.models?.extract ?? deps.defaultModel, "high"),
      context.pageImages ?? [],
    ),
  ]);
  stagesRun.push("classify", "extract");

  // Between stages, not inside one: a stage is a single call whose length the provider decides,
  // and the point of renewing is to say the run as a whole is still alive.
  if (deps.renewClaim && !(await deps.renewClaim())) throw new StagedParseClaimLostError();

  const patient = {
    existingConditions: context.existingConditions,
    existingFindings: context.existingFindings,
    checkupItems: context.checkupItems,
  };

  const reconcile = await runReconcileStage(
    extract.value,
    classify.value.record_date,
    patient,
    stageContext(deps, deps.models?.reconcile ?? deps.defaultModel),
  );
  const reconciled = !hasNothingToReconcile(patient);
  if (reconciled) stagesRun.push("reconcile");

  if (deps.renewClaim && !(await deps.renewClaim())) throw new StagedParseClaimLostError();

  const structured: StructuredDataWithEntities = {
    ...classify.value,
    observations: extract.value.observations,
    findings: extract.value.findings,
    conditions: extract.value.conditions,
    ...reconcile.value,
  };

  return {
    structured,
    // Only the stages that ran: a skipped reconcile made no call, so its placeholder must not
    // make the total read as unknown.
    usage: sumUsage(
      reconciled
        ? [classify.usage, extract.usage, reconcile.usage]
        : [classify.usage, extract.usage],
    ),
    rejected: [...classify.rejected, ...extract.rejected, ...reconcile.rejected],
    stagesRun,
  };
}
