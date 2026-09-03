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

export function pingExtension(timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(false);
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
      if (data.type !== "MONEY_IMPORT_PONG") return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(true);
    };
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: EXTENSION_WEBAPP_SOURCE, type: "MONEY_IMPORT_PING", ts: Date.now() },
      "*",
    );
  });
}

/** Sends one request and resolves with the reply that echoes its id, or null on timeout. */
export function requestFromExtension<T>(input: {
  type: string;
  replyType: string;
  payload?: Record<string, unknown>;
  read: (data: Record<string, unknown>) => T | null;
  timeoutMs?: number;
}): Promise<T | null> {
  return new Promise((resolve) => {
    const requestId = newRequestId();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, input.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== EXTENSION_BRIDGE_SOURCE) return;
      if (data.type !== input.replyType || data.request_id !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(input.read(data));
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
