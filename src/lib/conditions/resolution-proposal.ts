import type { RecordObservation } from "@/types/medical-record";
import { CLOSING_STATUSES } from "./unverified-closure";

/**
 * What each analyte entry requires, mirroring `RESOLVING_ANALYTES` in
 * `supabase/functions/health-structure/resolution.ts`.
 *
 * The citation names one code, but an entry can rest on more than one measurement: iron-deficiency
 * anaemia needs ferritin *and* haemoglobin, because haemoglobin is what makes it anaemia and
 * ferritin is what makes it iron deficiency. Re-checking only the cited code would confirm a
 * closure after the reviewer corrected the other half of it.
 *
 * Written twice on purpose, like `AUTHORITATIVE_STATUS_FILTER` beside it and for the same reason:
 * the Deno edge functions and this tree share no module. Change one and change the other. An
 * analyte missing from this map fails closed rather than falling back to the cited code alone —
 * if the copies have drifted, the safe answer about ending an entry in a medical record is no.
 */
const REQUIRED_OBSERVATIONS: Record<string, readonly string[]> = {
  vitamin_b12: ["vitamin_b12"],
  vitamin_d_25oh: ["vitamin_d_25oh"],
  ferritin: ["ferritin", "hemoglobin"],
};

/** The columns this re-check reads: what the record actually holds, not the whole row. */
export type PersistedObservation = Pick<
  RecordObservation,
  | "obs_code"
  | "is_applied"
  | "value_numeric"
  | "value_canonical"
  | "ref_range_low"
  | "ref_range_high"
  | "ref_range_low_canonical"
  | "ref_range_high_canonical"
  | "status"
>;

/**
 * Whether a proposed closure still rests on something, at the moment a person approves the record.
 *
 * The edge function checked the citation when it wrote the proposal, against the observations
 * extraction had just produced. Those are not the observations that end up on the record. Between
 * the two, a person reviewing the document can correct the cited value, change its catalogue code,
 * leave it unapplied -- activation deletes unapplied rows outright -- or delete it. The proposal
 * survives all of that untouched, and approving the record marks every unverified mention
 * verified, which is what makes a suppressed closure authoritative.
 *
 * So the claim is checked twice, against different evidence: once against what the model read, and
 * once against what the person left standing. Only the second one can be wrong in the direction
 * that ends an entry in someone's medical record.
 *
 * Narrower than the edge-side gate in `supabase/functions/health-structure/resolution.ts`, but
 * only in one respect: whether this analyte may speak to this condition is a property of the pair,
 * and neither the pair nor the analyte table moves between extraction and review. What moves is
 * the measurements -- all of the ones the entry requires, not only the one the citation names, or
 * a reviewer could correct the haemoglobin behind an iron-deficiency closure and still have it
 * confirmed. The in-range rule below is the same rule as that gate's `isObservationInRange`,
 * written twice because the two runtimes share no module -- change one and change the other.
 */
export function proposedClosureStillHolds(
  mention: {
    status_in_record: string;
    supporting_obs_code: string | null;
  },
  observations: PersistedObservation[],
): boolean {
  // Nothing to re-check: a mention that is not a lab-driven closure never rested on a measurement.
  if (!mention.supporting_obs_code) return true;
  if (!(CLOSING_STATUSES as readonly string[]).includes(mention.status_in_record)) return true;

  const required = REQUIRED_OBSERVATIONS[mention.supporting_obs_code];
  // An analyte this copy does not know cannot be re-checked, so it is not confirmed.
  if (!required) return false;

  return required.every((code) => {
    const rows = observations.filter((item) => item.obs_code === code && item.is_applied);
    // Deleted, unapplied, or recoded to something else: the requirement names nothing on this record.
    if (rows.length === 0) return false;
    return rows.every(isObservationInRange);
  });
}

/**
 * Is a persisted observation inside the range recorded for it?
 *
 * Canonical values first, because that is the pair the reviewer's edits keep consistent and the
 * only pair guaranteed to share a unit. A missing or unreadable number with a range recorded is
 * out of range rather than passing, and the stored status is the fallback only when no range was
 * recorded at all -- and then only the exact value `normal`.
 */
function isObservationInRange(
  observation: Pick<
    RecordObservation,
    | "value_numeric"
    | "value_canonical"
    | "ref_range_low"
    | "ref_range_high"
    | "ref_range_low_canonical"
    | "ref_range_high_canonical"
    | "status"
  >,
): boolean {
  const canonicalBounded =
    isFiniteNumber(observation.ref_range_low_canonical) ||
    isFiniteNumber(observation.ref_range_high_canonical);
  const low = canonicalBounded ? observation.ref_range_low_canonical : observation.ref_range_low;
  const high = canonicalBounded ? observation.ref_range_high_canonical : observation.ref_range_high;
  const value = canonicalBounded ? observation.value_canonical : observation.value_numeric;

  if (isFiniteNumber(low) || isFiniteNumber(high)) {
    if (!isFiniteNumber(value)) return false;
    if (isFiniteNumber(low) && value < low) return false;
    if (isFiniteNumber(high) && value > high) return false;
    return true;
  }

  return observation.status === "normal";
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
