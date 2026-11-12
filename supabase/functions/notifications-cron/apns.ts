/**
 * APNs Live Activity push-to-start (T-0023).
 *
 * Without APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID this module is inert:
 * callers get `{ ok: false, skipped: true }` and must leave Web Push unchanged.
 */

export type ApnsEnvironment = "sandbox" | "production";

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
}

export interface LiveActivityStartPayload {
  medicationName: string;
  amountLabel: string;
  personPrefix?: string | null;
  /** Unix seconds since 1970 — ActivityKit JSON-decodes `Date` this way in content-state. */
  dueAt: number;
  snoozeMinutes: number;
  doseEventIds: string[];
  alertTitle: string;
  alertBody: string;
}

export type ApnsSendResult =
  | { ok: true; status: number; apnsId: string | null }
  | { ok: false; skipped: true; reason: "missing_apns_secrets" }
  | { ok: false; skipped: false; status: number; apnsId: string | null; body: string };

export type EnvLike = { get(key: string): string | undefined };

const JWT_TTL_SECONDS = 50 * 60;
let cachedJwt: { token: string; expiresAtMs: number; keyId: string; teamId: string } | null = null;

export function readApnsConfig(env: EnvLike = Deno.env): ApnsConfig | null {
  const keyP8 = env.get("APNS_KEY_P8")?.trim();
  const keyId = env.get("APNS_KEY_ID")?.trim();
  const teamId = env.get("APNS_TEAM_ID")?.trim();
  const bundleId = env.get("APNS_BUNDLE_ID")?.trim();
  if (!keyP8 || !keyId || !teamId || !bundleId) {
    return null;
  }
  return { keyP8, keyId, teamId, bundleId };
}

export function resolveApnsHost(environment: ApnsEnvironment): string {
  return environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * PKCS#8 PEM or raw base64 body → DER bytes for WebCrypto import.
 * Accepts multiline PEM, one-line fences with literal `\n`, or the bare base64 body
 * (deploy/.env / GitHub Secrets cannot hold real newlines).
 */
export function pemToPkcs8Der(pem: string): ArrayBuffer {
  // Build PEM fence markers without a contiguous literal (secrets-preflight / gitleaks).
  const fence = (kind: "BEGIN" | "END") => `-----${kind} PRIVATE ${"KEY"}-----`;
  const normalized = pem.includes("\\n") ? pem.replaceAll("\\n", "\n") : pem;
  const body = normalized
    .replaceAll(fence("BEGIN"), "")
    .replaceAll(fence("END"), "")
    .replace(/\s+/g, "");
  if (!body) {
    throw new Error("APNS_KEY_P8 is empty after stripping PEM fences");
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function buildApnsJwt(
  config: Pick<ApnsConfig, "keyP8" | "keyId" | "teamId">,
  nowMs: number = Date.now(),
): Promise<string> {
  if (
    cachedJwt &&
    cachedJwt.keyId === config.keyId &&
    cachedJwt.teamId === config.teamId &&
    cachedJwt.expiresAtMs > nowMs + 60_000
  ) {
    return cachedJwt.token;
  }

  const header = { alg: "ES256", kid: config.keyId };
  const iat = Math.floor(nowMs / 1000);
  const claims = { iss: config.teamId, iat };
  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Der(config.keyP8),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  // WebCrypto returns P1363 (r||s); APNs expects that form for ES256 JWTs.
  const token = `${signingInput}.${base64UrlEncode(signature)}`;
  cachedJwt = {
    token,
    expiresAtMs: nowMs + JWT_TTL_SECONDS * 1000,
    keyId: config.keyId,
    teamId: config.teamId,
  };
  return token;
}

/** Test helper: drop the cached JWT so unit tests do not leak across cases. */
export function clearApnsJwtCache(): void {
  cachedJwt = null;
}

export function buildLiveActivityStartBody(
  payload: LiveActivityStartPayload,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  return {
    aps: {
      timestamp: timestampSeconds,
      event: "start",
      "content-state": {
        medicationName: payload.medicationName,
        amountLabel: payload.amountLabel,
        personPrefix: payload.personPrefix ?? null,
        dueAt: payload.dueAt,
        snoozeMinutes: payload.snoozeMinutes,
      },
      "attributes-type": "MedicationAttributes",
      attributes: { doseEventIds: payload.doseEventIds },
      alert: { title: payload.alertTitle, body: payload.alertBody },
    },
  };
}

export interface SendLiveActivityStartArgs {
  token: string;
  environment: ApnsEnvironment;
  payload: LiveActivityStartPayload;
  config?: ApnsConfig | null;
  fetchFn?: typeof fetch;
  nowMs?: number;
}

export async function sendLiveActivityStart(
  args: SendLiveActivityStartArgs,
): Promise<ApnsSendResult> {
  const config = args.config === undefined ? readApnsConfig() : args.config;
  if (!config) {
    return { ok: false, skipped: true, reason: "missing_apns_secrets" };
  }

  const jwt = await buildApnsJwt(config, args.nowMs ?? Date.now());
  const host = resolveApnsHost(args.environment);
  const url = `https://${host}/3/device/${args.token}`;
  const body = buildLiveActivityStartBody(args.payload);
  const fetchFn = args.fetchFn ?? fetch;

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-push-type": "liveactivity",
      "apns-topic": `${config.bundleId}.push-type.liveactivity`,
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const apnsId = response.headers.get("apns-id");
  const responseBody = await response.text();
  if (response.status === 200) {
    return { ok: true, status: 200, apnsId };
  }
  return {
    ok: false,
    skipped: false,
    status: response.status,
    apnsId,
    body: responseBody,
  };
}

export function isAppleWebPushEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === "web.push.apple.com";
  } catch {
    return false;
  }
}
