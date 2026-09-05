/**
 * The page's side of the conversation with the browser extension.
 *
 * The extension's content script listens on `window` for messages from the app and answers
 * through the same channel, so every request here is a `postMessage` with a request id and a
 * listener that waits for the reply carrying that id -- or gives up after a while, which is how
 * "the extension is not there" shows up. Nothing crosses this boundary unchecked: every reply
 * is read field by field.
 */

export const EXTENSION_WEBAPP_SOURCE = "orbit-webapp";
export const EXTENSION_BRIDGE_SOURCE = "orbit-extension";

const PING_TIMEOUT_MS = 500;
/** Longer than the ping: the reply needs the service worker awake and a few storage reads. */
const REQUEST_TIMEOUT_MS = 2500;

function newRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * What one ping learns. `alive`: the extension answered. `stale`: the content script in this
 * tab is from before an extension update and has no extension behind it any more; only a
 * reload of the page gets the script the new version injects. `silent`: no answer at all --
 * no extension, or one still waking up.
 */
export type ExtensionProbe = "alive" | "stale" | "silent";

export function probeExtension(timeoutMs: number = PING_TIMEOUT_MS): Promise<ExtensionProbe> {
  return new Promise((resolve) => {
    const finish = (verdict: ExtensionProbe) => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(verdict);
    };
    const timeout = window.setTimeout(() => finish("silent"), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
      if (data.type === "MONEY_IMPORT_PONG") finish("alive");
      else if (data.type === "MONEY_IMPORT_BRIDGE_STALE") finish("stale");
    };
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: EXTENSION_WEBAPP_SOURCE, type: "MONEY_IMPORT_PING", ts: Date.now() },
      "*",
    );
  });
}

export async function pingExtension(timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
  return (await probeExtension(timeoutMs)) === "alive";
}

/**
 * The first conversation on a page the extension opened itself is patient. At the browser's
 * start the content script is injected after the page's first render, and the service worker
 * that answers may still be waking: the page's first ping went unanswered and it said the
 * extension was not installed (2026-09-04). Eight probes, each sent at its offset from the
 * first, the last answered or given up on by about twelve seconds; a page that has heard the
 * extension once needs only one probe after that.
 */
export const STARTUP_PROBE_OFFSETS_MS: readonly number[] = [
  0, 300, 1000, 2000, 3500, 5500, 8500, 11500,
];
export const STARTUP_PROBE_TIMEOUT_MS = PING_TIMEOUT_MS;

export async function probeExtensionUntilHeard(
  offsetsMs: readonly number[] = STARTUP_PROBE_OFFSETS_MS,
  timeoutMs: number = STARTUP_PROBE_TIMEOUT_MS,
): Promise<ExtensionProbe> {
  const startedAtMs = Date.now();
  let verdict: ExtensionProbe = "silent";
  for (const offsetMs of offsetsMs) {
    // Offsets from one start rather than delays between probes: a probe's own timeout does not
    // push the ones after it, so the whole conversation ends when the last offset says.
    const waitMs = startedAtMs + offsetMs - Date.now();
    if (waitMs > 0) await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    verdict = await probeExtension(timeoutMs);
    if (verdict !== "silent") return verdict;
  }
  return verdict;
}

/**
 * Hears every stale notice the bridge posts, whichever request drew it: a page that has
 * heard the extension once probes only once per refresh, and a stale answer to an attention
 * or settings request would otherwise end as a timeout nobody could tell from a slow wake.
 * Returns the unsubscribe.
 */
export function onBridgeStale(listener: (reason: string | null) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
    if (data.type !== "MONEY_IMPORT_BRIDGE_STALE") return;
    listener(typeof data.reason === "string" ? data.reason : null);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** Separate so a test can stand in for it; jsdom has no navigation. */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * Sends one request and resolves with the reply that echoes its id, or null on timeout -- or
 * null at once when the bridge answers that it is stale, which `onBridgeStale` hears as well.
 */
export function requestFromExtension<T>(input: {
  type: string;
  replyType: string;
  payload?: Record<string, unknown>;
  read: (data: Record<string, unknown>) => T | null;
  timeoutMs?: number;
}): Promise<T | null> {
  return new Promise((resolve) => {
    const requestId = newRequestId();
    const finish = (value: T | null) => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), input.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
      if (data.type === "MONEY_IMPORT_BRIDGE_STALE") {
        finish(null);
        return;
      }
      if (data.type !== input.replyType || data.request_id !== requestId) return;
      finish(input.read(data));
    };
    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: EXTENSION_WEBAPP_SOURCE,
        type: input.type,
        request_id: requestId,
        ts: Date.now(),
        ...(input.payload ?? {}),
      },
      "*",
    );
  });
}

export interface ExtensionAttentionSource {
  source_id: string;
  last_ok_at: string | null;
  since: string;
  stale: boolean;
  stale_for_ms: number;
  run_requested: boolean;
}

export interface ExtensionAttention {
  grant: { person_id: string; allowed_sources: string[]; received_at: string } | null;
  stale_after_ms: number;
  stale_count: number;
  sources: ExtensionAttentionSource[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function readExtensionAttention(data: Record<string, unknown>): ExtensionAttention | null {
  if (data.ok !== true) return null;
  const grantRecord = asRecord(data.grant);
  const grant =
    grantRecord &&
    typeof grantRecord.person_id === "string" &&
    typeof grantRecord.received_at === "string" &&
    Array.isArray(grantRecord.allowed_sources)
      ? {
          person_id: grantRecord.person_id,
          allowed_sources: grantRecord.allowed_sources.filter(
            (source): source is string => typeof source === "string",
          ),
          received_at: grantRecord.received_at,
        }
      : null;
  const sources = (Array.isArray(data.sources) ? data.sources : [])
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .filter((record) => typeof record.source_id === "string" && typeof record.since === "string")
    .map((record) => ({
      source_id: record.source_id as string,
      last_ok_at: typeof record.last_ok_at === "string" ? record.last_ok_at : null,
      since: record.since as string,
      stale: record.stale === true,
      stale_for_ms: typeof record.stale_for_ms === "number" ? record.stale_for_ms : 0,
      run_requested: record.run_requested === true,
    }));
  return {
    grant,
    stale_after_ms: typeof data.stale_after_ms === "number" ? data.stale_after_ms : 0,
    stale_count: typeof data.stale_count === "number" ? data.stale_count : 0,
    sources,
  };
}

export function requestExtensionAttention(): Promise<ExtensionAttention | null> {
  return requestFromExtension({
    type: "MONEY_IMPORT_GET_ATTENTION",
    replyType: "MONEY_IMPORT_ATTENTION",
    read: readExtensionAttention,
  });
}

/** Asks the extension to open the bank for a source and run on the visit that follows. */
export async function requestExtensionRun(
  sourceId: string,
): Promise<{ ok: boolean; error: string | null }> {
  const reply = await requestFromExtension({
    type: "MONEY_IMPORT_REQUEST_RUN",
    replyType: "MONEY_IMPORT_RUN_REQUEST_ACK",
    payload: { source_id: sourceId },
    read: (data) => ({
      ok: data.ok === true,
      error: typeof data.error === "string" ? data.error : null,
    }),
  });
  return reply ?? { ok: false, error: null };
}

/** Stores the staleness threshold; resolves with what the extension kept, or null when it did not answer. */
export function setExtensionStaleAfter(staleAfterMs: number): Promise<number | null> {
  return requestFromExtension({
    type: "MONEY_IMPORT_SET_ATTENTION_SETTINGS",
    replyType: "MONEY_IMPORT_ATTENTION_SETTINGS_ACK",
    payload: { stale_after_ms: staleAfterMs },
    read: (data) =>
      data.ok === true && typeof data.stale_after_ms === "number" ? data.stale_after_ms : null,
  });
}
