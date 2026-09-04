import type { AutoRunStore } from "./auto-run-store.js";
import type { StoredImportGrant } from "./grant-store.js";
import { requestKey, type AttentionState } from "./attention-store.js";
import { describeSourceFreshness, isRunRequestLive } from "./attention-policy.js";

/**
 * What the attention page shows and the badge counts: per covered source, when it last
 * imported successfully and whether that is long enough ago to ask a person. One reading for
 * both, so the badge never says "1" over a page that lists nothing.
 */
export interface AttentionSourceStatus {
  source_id: string;
  last_ok_at: string | null;
  /** What staleness is counted from, as an ISO instant. */
  since: string;
  stale: boolean;
  stale_for_ms: number;
  /** A run the person asked for is still waiting on their visit to the bank. */
  run_requested: boolean;
}

export interface AttentionStatus {
  stale_after_ms: number;
  stale_count: number;
  sources: AttentionSourceStatus[];
}

export async function buildAttentionStatus(input: {
  grant: StoredImportGrant | null;
  /** The sources an unattended run can visit; a grant may name others the extension cannot reach. */
  knownSources: string[];
  autoRunStore: AutoRunStore;
  attention: AttentionState;
  nowMs: number;
}): Promise<AttentionStatus> {
  const sources: AttentionSourceStatus[] = [];
  if (input.grant) {
    const known = new Set(input.knownSources);
    const receivedAtMs = Date.parse(input.grant.received_at);
    for (const sourceId of input.grant.allowed_sources) {
      if (!known.has(sourceId)) continue;
      const scope = { sourceId, payerPersonId: input.grant.person_id };
      const state = await input.autoRunStore.getState(scope);
      const freshness = describeSourceFreshness(
        state,
        // A grant whose arrival cannot be read counts from the epoch: stale, and asked about.
        Number.isFinite(receivedAtMs) ? receivedAtMs : 0,
        input.nowMs,
        input.attention.staleAfterMs,
      );
      sources.push({
        source_id: sourceId,
        last_ok_at:
          freshness.lastOkAtMs === null ? null : new Date(freshness.lastOkAtMs).toISOString(),
        since: new Date(freshness.sinceMs).toISOString(),
        stale: freshness.stale,
        stale_for_ms: freshness.staleForMs,
        run_requested: isRunRequestLive(
          input.attention.runRequests[requestKey(scope)],
          input.nowMs,
        ),
      });
    }
  }
  return {
    stale_after_ms: input.attention.staleAfterMs,
    stale_count: sources.filter((source) => source.stale).length,
    sources,
  };
}
