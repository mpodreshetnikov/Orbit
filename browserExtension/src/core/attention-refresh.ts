import type { GrantStore } from "./grant-store.js";
import type { AutoRunStore } from "./auto-run-store.js";
import type { AttentionStore } from "./attention-store.js";
import { buildAttentionStatus } from "./attention-status.js";
import { shouldOpenAttentionPage } from "./attention-policy.js";

/**
 * Counts the sources that have gone quiet, shows the count on the icon, and -- when allowed
 * to -- opens the attention page for a person to act on.
 *
 * One refresh at a time. The browser's start and the alarm after it can land together, and two
 * refreshes reading the same "never opened" would both pass the once-a-day check and open two
 * pages; queued, the second reads what the first recorded. Kept free of `chrome.*` so that,
 * and the once-a-day limit, can be tested directly.
 */

/** Where the app lists what needs a person: opened by the extension when a source goes stale. */
export const ATTENTION_PAGE_PATH = "/money/import/attention";

export function buildAttentionPageUrl(appOrigin: string): string | null {
  try {
    return new URL(ATTENTION_PAGE_PATH, appOrigin).toString();
  } catch {
    return null;
  }
}

/**
 * Whether an origin a grant names is one of the app's own. The grant arrives over
 * `window.postMessage`, which anything on the page can send, and its origin is where the
 * extension later opens a tab; an origin that is not the app's is a link nobody asked to be
 * sent to, and is not opened.
 */
export function isAppOriginAllowed(candidate: string, allowedOrigins: string[]): boolean {
  let origin: string;
  try {
    origin = new URL(candidate).origin;
  } catch {
    return false;
  }
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === origin;
    } catch {
      return false;
    }
  });
}

export interface AttentionRefresherDeps {
  grantStore: GrantStore;
  autoRunStore: AutoRunStore;
  attentionStore: AttentionStore;
  /** The sources an unattended run can visit. */
  listSourceIds: () => string[];
  /** The app's own origins; a grant naming any other is not followed. */
  allowedAppOrigins: () => string[];
  setBadge: (staleCount: number) => Promise<void>;
  openPage: (url: string) => Promise<void>;
  /** A run a person started is in flight; the page is not opened over it. */
  hasActiveSession: () => Promise<boolean>;
  now: () => number;
  onInfo: (event: string, attrs: Record<string, unknown>) => void;
  onWarning: (event: string, attrs: Record<string, unknown>) => void;
}

export interface AttentionRefresher {
  /**
   * Opening the page is offered only from the start and the alarm. A page that opened itself a
   * minute after the person pressed Update, on the visit sweep their sign-in caused, would be
   * the extension nagging about the thing they are in the middle of fixing.
   */
  refresh(reason: string, options: RefreshOptions): Promise<void>;
}

export interface RefreshOptions {
  mayOpenPage: boolean;
  /**
   * For the alarm: open only if nothing has been opened since the browser last started. The
   * start itself is the moment a page opening by itself reads as a reminder; the alarm after
   * it stands in when the start found nothing stale yet, and never a third time during the
   * day's work.
   */
  onlyIfNotOpenedSinceStart?: boolean;
}

/** Whether the page has opened by itself since the browser last started. */
function openedSinceStart(attention: {
  lastOpenedAtMs: number | null;
  lastStartedAtMs: number | null;
}): boolean {
  if (attention.lastOpenedAtMs === null) return false;
  // No start on record: the opening counts as this browser session's.
  if (attention.lastStartedAtMs === null) return true;
  return attention.lastOpenedAtMs >= attention.lastStartedAtMs;
}

export function createAttentionRefresher(deps: AttentionRefresherDeps): AttentionRefresher {
  let chain: Promise<void> = Promise.resolve();

  async function run(reason: string, options: RefreshOptions): Promise<void> {
    try {
      const grant = await deps.grantStore.getGrant();
      const attention = await deps.attentionStore.getState();
      const nowMs = deps.now();
      const status = await buildAttentionStatus({
        grant,
        knownSources: deps.listSourceIds(),
        autoRunStore: deps.autoRunStore,
        attention,
        nowMs,
      });
      await deps.setBadge(status.stale_count);
      if (!options.mayOpenPage || !grant) return;
      // The alarm stands down for a person's own import; a page opening over it would take
      // their focus from the very thing that makes the source fresh.
      if (await deps.hasActiveSession()) return;
      if (
        !shouldOpenAttentionPage({
          staleCount: status.stale_count,
          lastOpenedAtMs: attention.lastOpenedAtMs,
          nowMs,
        })
      ) {
        return;
      }
      if (options.onlyIfNotOpenedSinceStart && openedSinceStart(attention)) return;
      if (!isAppOriginAllowed(grant.app_origin, deps.allowedAppOrigins())) {
        deps.onWarning("money_import_attention_origin_refused", { reason });
        return;
      }
      const url = buildAttentionPageUrl(grant.app_origin);
      if (!url) return;
      // Recorded before the tab exists: a page that fails to open is not retried on the next
      // refresh either, which is the cheaper mistake -- the badge still says what is stale.
      await deps.attentionStore.markPageOpened(nowMs);
      await deps.openPage(url);
      deps.onInfo("money_import_attention_page_opened", {
        reason,
        stale_count: status.stale_count,
      });
    } catch (error) {
      deps.onWarning("money_import_attention_check_failed", {
        reason,
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    refresh(reason, options) {
      const next = chain.then(() => run(reason, options));
      chain = next;
      return next;
    },
  };
}
