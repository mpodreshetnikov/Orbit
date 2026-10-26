import { emptyLlmUsage } from "../../_shared/llm-usage.ts";
import { normalizeClassification } from "./classify.ts";
import { normalizeExtraction } from "./extract.ts";
import { normalizeReconciliation } from "./reconcile.ts";
import { asObject, isTextGrounded, normalizeForGrounding } from "./normalize.ts";
import type { AssertedAbsence, StageRejection } from "./types.ts";
import { resolveBodySite, resolveFindingType, resolveObservation } from "../catalog.ts";
import { matchExistingFinding } from "../resolution.ts";
import type { HealthStructureParseContext } from "../service.ts";
import type {
  BodySiteCatalogItem,
  ExistingFinding,
  FindingToResolve,
  FindingTypeCatalogItem,
  StructuredParseOutcome,
} from "../types.ts";

/**
 * What an MCP client read from a document, in the shapes the model stages answer in.
 *
 * `classification` follows `CLASSIFY_SCHEMA`, `extraction` follows `EXTRACT_SCHEMA`, and
 * `reconciliation` follows `RECONCILE_SCHEMA`. Values and units are as printed: nothing here is a
 * canonical value or a resolved catalogue code the client computed for itself.
 */
export interface ClientSubmission {
  classification: unknown;
  extraction: unknown;
  reconciliation?: unknown;
}

/**
 * Stand in for the model stages with what the owner's Claude submitted (ADR-261021-z02).
 *
 * Every part goes through the same deterministic checks the model's answers went through —
 * classification coerced to the column types, every entity's anchor grounded in `documentText`,
 * every proposed id checked against the patient state — and the service downstream then resolves
 * codes, converts units and gates closures exactly as it does for the server pipeline. It has the
 * signature of `parseStructuredData`, so `runHealthStructureService` runs it unchanged.
 */
export function parseClientSubmission(
  submission: ClientSubmission,
  documentText: string,
  context: HealthStructureParseContext,
): StructuredParseOutcome {
  const classify = normalizeClassification(asObject(submission.classification));
  const extract = normalizeExtraction(asObject(submission.extraction), documentText);
  const reconcile = normalizeReconciliation(asObject(submission.reconciliation), {
    existingConditions: context.existingConditions,
    existingFindings: context.existingFindings,
    checkupItems: context.checkupItems,
  });

  const findingGate = gateFindingResolutions(
    reconcile.value.findings_to_resolve,
    extract.value.asserted_absences,
    documentText,
    context,
  );

  const unitMismatches: StageRejection[] = [];
  const observations = extract.value.observations.map((observation) => {
    // The client leaves codes null and prints labels as they are; the lab-closure gate reads
    // `obs_code`, so it is resolved here by the same catalogue lookup the observation rows use,
    // never taken from the caller.
    const resolution = resolveObservation(
      null,
      observation.obs_name,
      context.observationCatalog,
      observation.unit,
    );
    if (resolution.kind === "unresolved" && resolution.unitMismatch) {
      const entry = resolution.unitMismatch;
      unitMismatches.push({
        entityKind: "observation",
        reason: `"${observation.obs_name}" ${observation.value} ${observation.unit ?? ""}: the label names ${entry.obs_code} (${entry.name_ru}), which is kept in ${entry.canonical_unit} with no conversion from ${observation.unit}. It is stored unmatched. If it is the same analyte, give that entry the unit's conversion (upsert_catalog_entry with accepted_units); if it is another analyte, add it with create_catalog_entries; then re-ingest.`,
      });
    }
    return {
      ...observation,
      obs_code: resolution.kind === "resolved" ? resolution.entry.obs_code : null,
    };
  });

  return {
    structured: {
      ...classify.value,
      observations,
      // Codes are resolved from the printed labels, as for observations: a valid but wrong code from
      // the caller would otherwise win over the grounded label in `buildFindingRows`.
      findings: extract.value.findings.map((finding) => ({
        ...finding,
        finding_code: null,
        site_code: null,
      })),
      conditions: extract.value.conditions,
      ...reconcile.value,
      findings_to_resolve: findingGate.accepted,
    },
    usage: emptyLlmUsage(),
    stagesRun: [],
    issues: [...(classify.issues ?? []), ...extract.issues],
    rejected: [
      ...classify.rejected,
      ...extract.rejected,
      ...reconcile.rejected,
      ...findingGate.rejected,
      ...unitMismatches,
    ],
  };
}

/**
 * Hold a finding closure to the evidence the document itself gives.
 *
 * `processFindingsToResolve` writes a resolved finding row straight away, with no review step, so
 * on this path the rule the reconcile prompt only asks for is enforced here: a closure stands only
 * when it matches an open finding of this person, its anchor is in the document text, and an
 * asserted absence in this same extraction covers that finding — the same finding, at the same
 * site or at a site that contains it (no stones in the kidneys covers the right kidney; the reverse
 * does not hold, and a site-less absence covers only a site-less finding).
 */
export function gateFindingResolutions(
  proposals: FindingToResolve[],
  absences: AssertedAbsence[],
  documentText: string,
  catalogs: {
    existingFindings: ExistingFinding[];
    findingTypeCatalog: FindingTypeCatalogItem[];
    bodySiteCatalog: BodySiteCatalogItem[];
  },
): { accepted: FindingToResolve[]; rejected: StageRejection[] } {
  const haystack = normalizeForGrounding(documentText);
  const accepted: FindingToResolve[] = [];
  const rejected: StageRejection[] = [];
  const refuse = (reason: string) => rejected.push({ entityKind: "finding_to_resolve", reason });

  for (const proposal of proposals) {
    const existing = matchExistingFinding(proposal, catalogs.existingFindings);
    if (!existing) {
      refuse("no open finding of this person matches");
      continue;
    }
    if (!proposal.source_anchor || !isTextGrounded(proposal.source_anchor, haystack)) {
      refuse("source anchor not found in document text");
      continue;
    }
    const covered = absences.some((absence) => absenceCovers(absence, existing, catalogs));
    if (!covered) {
      refuse("no asserted absence in this document covers the finding");
      continue;
    }
    accepted.push(proposal);
  }
  return { accepted, rejected };
}

function absenceCovers(
  absence: AssertedAbsence,
  existing: ExistingFinding,
  catalogs: {
    findingTypeCatalog: FindingTypeCatalogItem[];
    bodySiteCatalog: BodySiteCatalogItem[];
  },
): boolean {
  // Resolved from the absence's own words; the caller's codes are not evidence.
  const type = resolveFindingType(null, absence.finding_type_text, catalogs.findingTypeCatalog);
  const sameFinding =
    type.kind === "resolved" && existing.finding_code
      ? type.entry.finding_code === existing.finding_code
      : absence.finding_type_text.toLowerCase().trim() ===
        existing.finding_type_text.toLowerCase().trim();
  if (!sameFinding) return false;

  if (!absence.body_site_text) return !existing.site_code && !existing.body_site_text;
  // A finding whose site the catalogue never resolved is matched by its printed site alone; the
  // hierarchy needs codes on both sides.
  if (!existing.site_code) {
    return (
      Boolean(existing.body_site_text) &&
      normalizeForGrounding(absence.body_site_text) ===
        normalizeForGrounding(existing.body_site_text ?? "")
    );
  }

  const site = resolveBodySite(null, absence.body_site_text, catalogs.bodySiteCatalog);
  if (site.kind !== "resolved") return false;
  return siteContains(site.entry.site_code, existing.site_code, catalogs.bodySiteCatalog);
}

/** True when `outer` is `inner` or one of its ancestors through `parent_site_code`. */
function siteContains(outer: string, inner: string, catalog: BodySiteCatalogItem[]): boolean {
  const parentOf = new Map(catalog.map((item) => [item.site_code, item.parent_site_code]));
  let current: string | null | undefined = inner;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === outer) return true;
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}
