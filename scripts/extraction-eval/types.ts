/** Shapes the corpus stores on disk, and the normalised shape the pipeline produces. */

export interface ExpectedObservation {
  obs_name: string;
  obs_code: string | null;
  value_numeric: number | null;
  unit: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  status: string | null;
  value_canonical: number | null;
  unit_canonical: string | null;
  is_applied: boolean;
}

export interface ExpectedFinding {
  finding_code: string | null;
  finding_type_text: string;
  site_code?: string | null;
  body_site_text?: string | null;
  size_mm?: number | null;
  severity?: string | null;
  laterality?: string | null;
  count?: number | null;
}

export interface ExpectedCondition {
  name: string;
  icd_code?: string | null;
  status?: string | null;
}

/**
 * A condition the document shows to have resolved, and the measurement it says so on.
 *
 * `supporting_obs_code` is not decoration: `checkLabResolution` discards a resolution that cites
 * nothing, cites an analyte no table entry covers, or cites one unrelated to the condition, so the
 * citation is the difference between a proposal that reaches a person and one that is thrown away.
 * Scoring it is therefore scoring whether the closure would happen at all — a resolution keyed to
 * the right condition on the wrong analyte is a pass under set scoring and a discard in production.
 */
export interface ExpectedResolution {
  condition_id: string;
  supporting_obs_code?: string | null;
}

/**
 * A finding the document shows to have resolved.
 *
 * Unlike a condition resolution this carries no id — the reconcile stage matches existing findings
 * by text and site, so that pair is the only identity available (`stages/reconcile.ts:195-206`).
 * Both halves are load-bearing: resolving the right finding type on the wrong organ is a wrongful
 * closure, not a near miss, so `site_code` belongs in the match key rather than in a field check.
 */
export interface ExpectedFindingResolution {
  finding_type_text: string;
  finding_code?: string | null;
  site_code?: string | null;
  body_site_text?: string | null;
}

export interface ExpectedCheckup {
  checkup_item_id: string;
  suggested_done_at: string | null;
}

/** `expected.json`, and the same shape the pipeline is normalised into so the two can be diffed. */
export interface CaseSnapshot {
  record_type: string | null;
  record_date: string | null;
  observations: ExpectedObservation[];
  findings: ExpectedFinding[];
  conditions: ExpectedCondition[];
  findings_to_resolve: ExpectedFindingResolution[];
  conditions_to_resolve: ExpectedResolution[];
  checkups_to_complete: ExpectedCheckup[];
}

/** Non-scored signals worth printing next to the scores. */
export interface CaseDiagnostics {
  stagesRun: string[];
  rejected: { entityKind: string; reason: string }[];
  droppedInvalidCount: number;
  unresolvedCatalogCount: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /**
   * What this case cost to run, in USD, as priced by the router.
   *
   * Null rather than zero when unknown -- a replayed cassette recorded before usage accounting was
   * requested has no price attached, and reporting that as $0.00 would understate a live run's real
   * total by however many cases happened to be stale.
   */
  costUsd: number | null;
}
