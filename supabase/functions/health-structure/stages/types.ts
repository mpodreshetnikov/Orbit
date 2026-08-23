import type {
  BodySiteCatalogItem,
  CheckupItemForContext,
  ExistingCondition,
  ExistingFinding,
  ExtractedCondition,
  ExtractedFinding,
  ExtractedObservation,
  FindingTypeCatalogItem,
  ObservationCatalogItem,
  StructuredData,
  CheckupToComplete,
  ConditionToResolve,
  FindingToResolve,
} from "../types.ts";

/**
 * Everything a stage needs to talk to the model. Each stage carries its own model, effort and
 * timeout so an expensive stage and a cheap one can be tuned independently.
 */
export interface StageContext {
  fetchFn: typeof fetch;
  apiKey: string;
  model: string;
  /** Tried in order after `model` if the primary is unavailable. */
  fallbackModels?: string[];
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
  /** Output budget for one call. Defaults in the client; see `DEFAULT_MAX_TOKENS` there. */
  maxTokens?: number;
  maxAttempts?: number;
  log?: Pick<Console, "log" | "warn" | "error">;
  debugRawPayload?: boolean;
  /** Injected in tests so retries do not actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
  jitterFn?: () => number;
}

export interface StageUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  /** What the router charged for this call, in USD. Null when unknown -- never assume zero. */
  costUsd: number | null;
}

export interface StageRejection {
  entityKind: string;
  reason: string;
}

export interface StageResult<T> {
  value: T;
  usage: StageUsage;
  finishReason: string | null;
  rejected: StageRejection[];
}

/**
 * The three catalogues, and nothing else. The extraction stage receives exactly this — there is
 * deliberately no field through which the patient's history could arrive.
 */
export type CatalogContext = {
  observationCatalog: ObservationCatalogItem[];
  findingTypeCatalog: FindingTypeCatalogItem[];
  bodySiteCatalog: BodySiteCatalogItem[];
};

/**
 * The patient's current state, and nothing else. The reconciliation stage receives exactly this
 * plus already-extracted entities — there is deliberately no field for the document text.
 */
export type PatientStateContext = {
  existingConditions: ExistingCondition[];
  existingFindings: ExistingFinding[];
  checkupItems: CheckupItemForContext[];
};

export type ClassifyResult = StructuredData;

export interface ExtractResult {
  observations: ExtractedObservation[];
  findings: ExtractedFinding[];
  conditions: ExtractedCondition[];
  /**
   * Findings the document explicitly states are absent.
   *
   * Not a finding and never written to the chart. It exists so that reconciliation can see the one
   * kind of evidence that closes an existing finding — `Конкременты: нет` says a previously
   * recorded stone is gone, and extraction, which reports what is present, otherwise discards it.
   */
  asserted_absences: AssertedAbsence[];
}

/** A finding the document says is not there. Grounded like any other entity. */
export interface AssertedAbsence {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  source_anchor: string;
  confidence: number;
}

export interface ReconcileResult {
  findings_to_resolve: FindingToResolve[];
  conditions_to_resolve: ConditionToResolve[];
  checkups_to_complete: CheckupToComplete[];
}

export const EMPTY_RECONCILE: ReconcileResult = {
  findings_to_resolve: [],
  conditions_to_resolve: [],
  checkups_to_complete: [],
};

export function emptyUsage(): StageUsage {
  return { promptTokens: null, completionTokens: null, costUsd: null };
}

export function sumUsage(parts: StageUsage[]): StageUsage {
  let prompt: number | null = null;
  let completion: number | null = null;
  let cost: number | null = null;
  for (const part of parts) {
    if (part.promptTokens !== null) prompt = (prompt ?? 0) + part.promptTokens;
    if (part.completionTokens !== null) completion = (completion ?? 0) + part.completionTokens;
    if (part.costUsd !== null) cost = (cost ?? 0) + part.costUsd;
  }
  return { promptTokens: prompt, completionTokens: completion, costUsd: cost };
}
