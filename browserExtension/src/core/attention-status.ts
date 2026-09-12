import type { AutoRunStore } from "./auto-run-store.js";
import type { StoredImportGrant } from "./grant-store.js";
import { requestKey, type AttentionState } from "./attention-store.js";
import { describeSourceFreshness, isRunRequestLive } from "./attention-policy.js";
import {
  describeAutoRunEligibility,
  lastAttemptOf,
  type AutoRunOrigin,
  type AutoRunState,
} from "./auto-run-policy.js";
import type { LiveRun, RunBoard, RunOrigin, RunWindowKind } from "./run-board.js";

/**
 * A run in flight, as a page may show it. A projection of the board's record: the tab id and
 * the estimates the widget needs stay behind, and nothing here is a credential. Only a run
 * still running is one: a record that has seen its done or error broadcast and waits for the
 * runner to take it off the board is finished, and the page must not call it in progress.
 */
export interface AttentionLiveRun {
  origin: RunOrigin;
  window_kind: RunWindowKind;
  window_from: string | null;
  window_to: string | null;
  started_at: string;
  running: boolean;
  phase: string | null;
  progress_percent: number;
  parsed_transactions_count: number | null;
  batch_id: string | null;
  error: string | null;
}

/** The last attempt on record for a source: when, how it ended, and what it said. */
export interface AttentionLastAttempt {
  at: string;
  result: "ok" | "error";
  error: string | null;
  origin: AutoRunOrigin | null;
}

export type AttentionNextRun =
  | { kind: "now" }
  | { kind: "after"; at: string }
  | { kind: "stopped" };

export function describeLiveRun(run: LiveRun | null): AttentionLiveRun | null {
  if (!run || !run.running) return null;
  return {
    origin: run.origin,
    window_kind: run.window_kind,
    window_from: run.window_from,
    window_to: run.window_to,
    started_at: run.started_at,
    running: run.running,
    phase: run.phase,
    progress_percent: run.progress_percent,
    parsed_transactions_count: run.parsed_transactions_count,
    batch_id: run.batch_id,
    error: run.error,
  };
}

export function describeLastAttempt(state: AutoRunState): AttentionLastAttempt | null {
  const attempt = lastAttemptOf(state);
  if (!attempt) return null;
  return {
    at: new Date(attempt.atMs).toISOString(),
    result: attempt.result,
    error: attempt.error,
    origin: attempt.origin,
  };
}

export function describeNextRun(state: AutoRunState, nowMs: number): AttentionNextRun {
  const eligibility = describeAutoRunEligibility(state, nowMs);
  return eligibility.kind === "after"
    ? { kind: "after", at: new Date(eligibility.atMs).toISOString() }
    : { kind: eligibility.kind };
}

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
  /** The run reading this source right now, if any. */
  live_run: AttentionLiveRun | null;
  /** The last attempt of any kind, automatic or a person's. Null before the first. */
  last_attempt: AttentionLastAttempt | null;
  /** When the sweep may next run this source on its own. */
  next_run: AttentionNextRun;
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
  /** The runs in flight; without it no source reports one. */
  liveRuns?: Pick<RunBoard, "findBySource">;
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
        live_run: describeLiveRun(
          input.liveRuns?.findBySource(sourceId, input.grant.person_id) ?? null,
        ),
        last_attempt: describeLastAttempt(state),
        next_run: describeNextRun(state, input.nowMs),
      });
    }
  }
  return {
    stale_after_ms: input.attention.staleAfterMs,
    stale_count: sources.filter((source) => source.stale).length,
    sources,
  };
}
