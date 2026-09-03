import type { StoredImportGrant, GrantStore } from "./grant-store.js";
import type { SessionStore } from "./session-store.js";
import type { AutoRunStore } from "./auto-run-store.js";
import { nextAutoRunState, shouldAutoRun } from "./auto-run-policy.js";

/**
 * Decides and drives an import nobody asked for.
 *
 * Kept free of `chrome.*` so the parts that matter can be tested directly: that two triggers
 * cannot start two runs, that a run always works in a tab this code opened and always closes it
 * again, and that a failure widens the backoff instead of retrying at every page load.
 */

export interface AutoImportSourceTarget {
  sourceId: string;
  /** Where to open the bank. A source without one cannot be swept unattended. */
  targetUrl: string;
}

export interface AutoImportSweepDeps {
  listSources: () => AutoImportSourceTarget[];
  grantStore: GrantStore;
  sessionStore: SessionStore;
  autoRunStore: AutoRunStore;
  /** Opens a background tab and resolves its id, or null when the browser gave none. */
  openTab: (url: string) => Promise<number | null>;
  /** Resolves true once the tab has finished loading, false on timeout or a tab that vanished. */
  waitForTabComplete: (tabId: number) => Promise<boolean>;
  closeTab: (tabId: number) => Promise<void>;
  runImport: (input: {
    grant: StoredImportGrant;
    sourceId: string;
    tabId: number;
    nowMs: number;
  }) => Promise<{ backfillError?: { message: string } } | undefined>;
  now: () => number;
  onWarning: (event: string, attrs: Record<string, unknown>) => void;
  /**
   * A run a person asked for from the attention page. Honoured past the cooldown and past the
   * stop after failures: they have just been told the source is stale and have gone to sign in,
   * and the failures being backed off from were the signed-out bank they are fixing. The request
   * lives until the run succeeds or it expires -- not consumed by the attempt, because a visit
   * that lands before the person has finished signing in would spend it on the login screen.
   */
  isRunRequested?: (sourceId: string, nowMs: number) => Promise<boolean>;
  clearRunRequest?: (sourceId: string) => Promise<void>;
}

export type AutoImportTrigger = "visit" | "alarm";

export interface AutoImportRunOptions {
  /**
   * Restrict the sweep to one source. A visit to a bank is evidence that *that* bank's session
   * is live and says nothing about any other -- so a visit sweeps the bank that was visited, and
   * only the alarm sweeps everything. Without this, opening T-Bank opened Alfa-Bank too.
   */
  sourceId?: string;
}

/**
 * Whether the server refused the credential itself, rather than failing for any other reason.
 *
 * Matched on the status the edge function returns, because everything else -- a signed-out bank,
 * a page that would not load, a rate limit -- must widen the backoff and keep the grant.
 */
export function isCredentialRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(401|403)\b/.test(message) || /unauthorized|forbidden/i.test(message);
}

export interface AutoImportSweep {
  run: (trigger: AutoImportTrigger, options?: AutoImportRunOptions) => Promise<void>;
  /**
   * Whether a tab is one this sweep opened and has not yet closed. A page finishing its load
   * in such a tab is not a visit: it is the sweep's own doing, and counting it scheduled
   * another sweep a minute later -- which, with a run request held past a failed attempt,
   * meant a failed attempt at the bank every minute for as long as the request lived.
   */
  ownsTab: (tabId: number) => boolean;
}

export function createAutoImportSweep(deps: AutoImportSweepDeps): AutoImportSweep {
  /**
   * Held for a whole sweep so two triggers cannot run one.
   *
   * Set before the first `await` on purpose: every check below is asynchronous, so a second
   * trigger arriving during any of them would pass the same checks and start a second run
   * against the same bank. That is not theoretical -- opening a tab is itself a navigation, and
   * navigation is one of the triggers.
   */
  let inFlight = false;

  /**
   * Sources asked for while a sweep was busy. A visit to one bank a minute after a visit to
   * another lands its alarm mid-sweep; dropping it there meant that bank waited for the next
   * visit or the three-hour alarm, where before the scoping it would have been taken in the
   * same pass. Queued instead, and drained by the sweep that is running -- or, if that sweep
   * stood down for a manual run, by the next one to start. Held in memory like `inFlight`: a
   * worker teardown loses both, and the alarm that would have queued the source has already
   * fired, so the periodic alarm is the backstop either way.
   */
  const pending = new Set<string>();
  let pendingAll = false;
  const ownedTabs = new Set<number>();

  /**
   * Runs one source in a tab opened for the purpose.
   *
   * The tab is always this code's own, never one the person opened, and that is the point of the
   * shape. The connector navigates whatever tab it is given to the operations page and then
   * clicks through operations to make the receipt requests fire; doing that to the tab someone
   * is reading would take their bank out from under them, and could interrupt a half-filled
   * transfer. A second background tab shares the same cookies, so it is just as authorised and
   * costs nobody their place.
   */
  async function runSource(
    source: AutoImportSourceTarget,
    grant: StoredImportGrant,
  ): Promise<void> {
    if (!source.targetUrl) return;

    const nowMs = deps.now();
    const scope = { sourceId: source.sourceId, payerPersonId: grant.person_id };
    const state = await deps.autoRunStore.getState(scope);
    const requested = (await deps.isRunRequested?.(source.sourceId, nowMs)) ?? false;
    if (!requested && !shouldAutoRun(state, nowMs)) return;

    const tabId = await deps.openTab(source.targetUrl);
    if (tabId === null) return;
    ownedTabs.add(tabId);

    try {
      if (!(await deps.waitForTabComplete(tabId))) {
        throw new Error(`${source.sourceId} did not finish loading`);
      }
      const outcome = await deps.runImport({ grant, sourceId: source.sourceId, tabId, nowMs });

      // A history slice can fail while the catch-up window succeeds. That is not a failed run --
      // the cursor holds and the slice is taken again -- but it must not be silent either, or a
      // connector that has stopped working retries for weeks with nothing to say so.
      if (outcome?.backfillError) {
        deps.onWarning("money_import_auto_backfill_failed", {
          source_id: source.sourceId,
          error_message: outcome.backfillError.message,
        });
      }

      await deps.autoRunStore.setState(scope, nextAutoRunState(state, nowMs, "ok"));
      if (requested) await deps.clearRunRequest?.(source.sourceId);
    } catch (error) {
      // A signed-out bank is the ordinary failure here, not an emergency. It is recorded so the
      // backoff widens and the attempts stop after a few, and the person is told nothing: they
      // did not ask for this run and there is nothing for them to do about it.
      const errorMessage = error instanceof Error ? error.message : String(error);
      deps.onWarning("money_import_auto_run_failed", {
        source_id: source.sourceId,
        error_message: errorMessage,
      });
      await deps.autoRunStore.setState(
        scope,
        nextAutoRunState(state, nowMs, "error", errorMessage),
      );

      // Revoking a grant happens in the app and reaches the database, not this extension -- so
      // the only way the extension learns is the server refusing it. Holding on to a credential
      // the server has finished with means opening bank tabs to make doomed requests, so the
      // refusal is taken at its word and the grant is dropped.
      if (isCredentialRefusal(error)) {
        deps.onWarning("money_import_auto_grant_dropped", { source_id: source.sourceId });
        await deps.grantStore.setGrant(null);
      }
    } finally {
      // However the attempt ended: a tab left open is a bank page the person never asked for.
      // The session field is cleared by the run itself, which is the only party that knows
      // whether the session still there is its own or one a person has just started.
      await deps.closeTab(tabId);
      ownedTabs.delete(tabId);
    }
  }

  return {
    ownsTab: (tabId) => ownedTabs.has(tabId),
    async run(trigger, options = {}) {
      if (inFlight) {
        if (options.sourceId) pending.add(options.sourceId);
        else pendingAll = true;
        return;
      }
      inFlight = true;

      try {
        // This call's own scope, plus whatever was queued while a sweep was busy. `undefined`
        // means every source the grant covers.
        let sourceIds: Set<string> | undefined = options.sourceId
          ? new Set([options.sourceId])
          : undefined;

        do {
          if (pendingAll) sourceIds = undefined;
          else if (sourceIds) for (const id of pending) sourceIds.add(id);
          pending.clear();
          pendingAll = false;

          const grant = await deps.grantStore.getGrant();
          // No grant means automatic import was never turned on, or has been revoked. Revoking
          // is the off switch, and it has to work here as well as at the server. Nothing queued
          // survives it: there is no credential to run with.
          if (!grant) return;

          // A run the person started owns the session field and the bank's rate limits; a
          // second one racing it would cost them both. For a visit this check is also what the
          // grace period exists for: the sweep is deferred a minute after the page loads so that
          // a person who opened their bank to import by hand has started by the time this runs,
          // and is found here. What was asked for is kept for the next sweep, not dropped.
          if (await deps.sessionStore.getSession()) {
            if (sourceIds) for (const id of sourceIds) pending.add(id);
            else pendingAll = true;
            return;
          }

          for (const source of deps.listSources()) {
            if (sourceIds && !sourceIds.has(source.sourceId)) continue;
            // `parseIncomingGrant` refuses a grant that names no sources, so an empty list cannot
            // reach here -- and reading one as "every source" would be the wrong way to be wrong.
            if (!grant.allowed_sources.includes(source.sourceId)) continue;
            await runSource(source, grant);
          }

          // Anything queued during this pass is taken now rather than left for hours.
          sourceIds = new Set();
        } while (pendingAll || pending.size > 0);
      } catch (error) {
        deps.onWarning("money_import_auto_sweep_failed", {
          trigger,
          error_message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlight = false;
      }
    },
  };
}
