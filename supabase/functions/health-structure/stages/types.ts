import { emptyLlmUsage, type LlmUsage, sumLlmUsage } from "../../_shared/llm-usage.ts";
import type {
  BodySiteCatalogItem,
  CheckupItemForContext,
  ExistingCondition,
  ExistingFinding,
  ExtractedCondition,
  ExtractedFinding,
  ExtractedObservation,
  ExtractionIssue,
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
  /**
   * Say the run is still working, while this stage waits.
   *
   * Renewing only between stages is not enough: one stage can be three attempts and their
   * backoff, so the gap between renewals could outrun the lease and the reaper would release a
   * live run. This is called during that waiting, and a false answer stops the stage.
   */
  renewClaim?: () => Promise<boolean>;
}

/** One shape for what a model call cost, shared with the other edge functions. */
export type StageUsage = LlmUsage;

export interface StageRejection {
  entityKind: string;
  reason: string;
}

/** Thrown when a renewal reports the record now belongs to another run. */
export class StagedParseClaimLostError extends Error {
  constructor() {
    super("Another run owns this record");
    this.name = "StagedParseClaimLostError";
  }
}

export interface StageResult<T> {
  value: T;
  usage: StageUsage;
  finishReason: string | null;
  rejected: StageRejection[];
  /** Value-level corrections, in a shape that reaches the record rather than only a log line. */
  issues?: ExtractionIssue[];
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
  return emptyLlmUsage();
}

export function sumUsage(parts: StageUsage[]): StageUsage {
  return sumLlmUsage(parts);
}
