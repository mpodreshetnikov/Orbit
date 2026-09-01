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
  }) => Promise<unknown>;
  now: () => number;
  onWarning: (event: string, attrs: Record<string, unknown>) => void;
}

export type AutoImportTrigger = "visit" | "alarm";

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
  run: (trigger: AutoImportTrigger) => Promise<void>;
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
    if (!shouldAutoRun(state, nowMs)) return;

    const tabId = await deps.openTab(source.targetUrl);
    if (tabId === null) return;

    try {
      if (!(await deps.waitForTabComplete(tabId))) {
        throw new Error(`${source.sourceId} did not finish loading`);
      }
      await deps.runImport({ grant, sourceId: source.sourceId, tabId, nowMs });
      await deps.autoRunStore.setState(scope, nextAutoRunState(state, nowMs, "ok"));
    } catch (error) {
      // A signed-out bank is the ordinary failure here, not an emergency. It is recorded so the
      // backoff widens and the attempts stop after a few, and the person is told nothing: they
      // did not ask for this run and there is nothing for them to do about it.
      deps.onWarning("money_import_auto_run_failed", {
        source_id: source.sourceId,
        error_message: error instanceof Error ? error.message : String(error),
      });
      await deps.autoRunStore.setState(scope, nextAutoRunState(state, nowMs, "error"));

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
    }
  }

  return {
    async run(trigger) {
      if (inFlight) return;
      inFlight = true;

      try {
        const grant = await deps.grantStore.getGrant();
        // No grant means automatic import was never turned on, or has been revoked. Revoking is
        // the off switch, and it has to work here as well as at the server.
        if (!grant) return;

        // A run the person started owns the session field and the bank's rate limits; a second
        // one racing it would cost them both.
        if (await deps.sessionStore.getSession()) return;

        for (const source of deps.listSources()) {
          // `parseIncomingGrant` refuses a grant that names no sources, so an empty list cannot
          // reach here -- and reading one as "every source" would be the wrong way to be wrong.
          if (!grant.allowed_sources.includes(source.sourceId)) continue;
          await runSource(source, grant);
        }
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
