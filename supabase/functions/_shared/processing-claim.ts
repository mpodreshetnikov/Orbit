/**
 * Owning a record while a long pipeline runs.
 *
 * Two workers on the same record were serialised by nothing. A status predicate cannot do it:
 * once the first worker has set `structuring`, the predicate still matches for the second, so
 * both proceed. And the terminal writes updated by id alone, so a worker whose client had long
 * given up still overwrote the state that replaced it -- the record's fate was decided by
 * whoever wrote last rather than by whoever was asked to do the work.
 *
 * The claim names its owner. Taking it is one conditional update: it succeeds only when the
 * record is unclaimed or its claim has expired past the lease, and it returns the run id that
 * every later write must present. A worker whose claim is gone throws its result away.
 */

/**
 * How long a claim stays valid without being renewed.
 *
 * Long enough that a slow but live run is never stolen from -- multi-page OCR against a
 * struggling provider is minutes, not seconds -- and short enough that a worker killed
 * mid-flight does not lock the record until a human notices.
 */
export const DEFAULT_CLAIM_LEASE_MS = 15 * 60 * 1000;

export interface ClaimExpiry {
  /** Rows whose claim started before this instant are abandoned and may be taken over. */
  staleBefore: string;
  runId: string;
  startedAt: string;
}

export function newClaim(
  now: Date = new Date(),
  leaseMs: number = DEFAULT_CLAIM_LEASE_MS,
): ClaimExpiry {
  return {
    runId: crypto.randomUUID(),
    startedAt: now.toISOString(),
    staleBefore: new Date(now.getTime() - leaseMs).toISOString(),
  };
}

/**
 * The PostgREST filter for "nobody owns this, or whoever did has gone away".
 *
 * Written here rather than at each call site so the two functions cannot drift into disagreeing
 * about what an abandoned claim is.
 */
export function unclaimedOrExpired(staleBefore: string): string {
  return `processing_run_id.is.null,processing_started_at.lt.${staleBefore}`;
}

/** Thrown by a worker that discovers the record is no longer its to write to. */
export class ClaimLostError extends Error {
  constructor(recordId: string) {
    super(`Another run owns record ${recordId}`);
    this.name = "ClaimLostError";
  }
}
