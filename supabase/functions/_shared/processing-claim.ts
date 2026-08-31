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

/**
 * How long a claim stays valid without being renewed, in seconds -- the database applies it
 * against its own clock, so no timestamp has to survive a round trip through a query string.
 */
export const DEFAULT_CLAIM_LEASE_SECONDS = DEFAULT_CLAIM_LEASE_MS / 1000;

interface ClaimRpcClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Take the claim, or report that another run holds it.
 *
 * One statement, evaluated by the database: the predicate this rests on -- unclaimed, or the
 * previous claim has outlived its lease -- must not be assembled from separate filters that can
 * disagree about what "now" is.
 */
export async function claimRecordViaRpc(
  client: ClaimRpcClient,
  recordId: string,
  status: string,
  leaseSeconds: number = DEFAULT_CLAIM_LEASE_SECONDS,
): Promise<string | null> {
  const runId = crypto.randomUUID();
  const { data, error } = await client.rpc("claim_medical_record", {
    p_record_id: recordId,
    p_run_id: runId,
    p_status: status,
    p_lease_seconds: leaseSeconds,
  });

  if (error) throw new Error(`Failed to claim record: ${error.message}`);
  return data === true ? runId : null;
}

/**
 * Tell the database this run is still working.
 *
 * Returns false when the claim has already been taken over -- the caller has lost the record and
 * should stop rather than keep paying a provider for a result it may not write.
 */
export async function renewClaimViaRpc(
  client: ClaimRpcClient,
  recordId: string,
  runId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("renew_medical_record_claim", {
    p_record_id: recordId,
    p_run_id: runId,
  });

  if (error) throw new Error(`Failed to renew claim: ${error.message}`);
  return data === true;
}

/** Thrown by a worker that discovers the record is no longer its to write to. */
export class ClaimLostError extends Error {
  constructor(recordId: string) {
    super(`Another run owns record ${recordId}`);
    this.name = "ClaimLostError";
  }
}
