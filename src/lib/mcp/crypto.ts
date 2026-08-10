import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CONSENT_TOKEN_TTL_SECONDS, SUPABASE_JWT_TTL_SECONDS } from "./config";

/**
 * Cryptographic primitives for the MCP OAuth server.
 *
 * Two things worth knowing before editing:
 *  - Tokens are only ever persisted as SHA-256 hashes. A plain SHA-256 (rather
 *    than a password hash) is right here because the inputs are 256-bit random
 *    values, so there is nothing to brute-force.
 *  - Every comparison of a secret goes through `timingSafeEqualHex`.
 */

export function base64UrlEncode(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

/** 32 bytes of CSPRNG output, base64url encoded. Used for codes and tokens. */
export function generateToken(): string {
  return base64UrlEncode(randomBytes(32));
}

/** Opaque client identifier. Prefixed so it is recognisable in logs. */
export function generateClientId(): string {
  return `mcp_${randomBytes(16).toString("hex")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  if (bufferA.length === 0 || bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * PKCE S256 verification (RFC 7636): the challenge is the base64url-encoded
 * SHA-256 of the verifier. `plain` is not supported anywhere in this server.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  // RFC 7636 section 4.1 constrains the verifier to 43-128 unreserved characters.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) {
    return false;
  }

  const expected = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(codeChallenge);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

// ============================================================================
// Consent token
// ============================================================================

/**
 * The authorize page renders a consent form, and the browser posts the decision
 * back. Without protection a user could edit the posted fields and approve a
 * grant for a different client or a wider scope than they were shown. So the
 * page emits an HMAC over the exact parameters it displayed, and the decision
 * handler re-derives it rather than trusting the form.
 */
export interface ConsentTokenPayload {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
}

function canonicalizeConsentPayload(payload: ConsentTokenPayload, expiresAt: number): string {
  return [
    payload.clientId,
    payload.redirectUri,
    payload.scope,
    payload.state ?? "",
    payload.codeChallenge,
    payload.resource ?? "",
    String(expiresAt),
  ].join("\n");
}

export function createConsentToken(
  payload: ConsentTokenPayload,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const expiresAt = nowSeconds + CONSENT_TOKEN_TTL_SECONDS;
  const signature = createHmac("sha256", secret)
    .update(canonicalizeConsentPayload(payload, expiresAt))
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

export function verifyConsentToken(
  token: string,
  payload: ConsentTokenPayload,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < nowSeconds) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(canonicalizeConsentPayload(payload, expiresAt))
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}

// ============================================================================
// Supabase user JWT
// ============================================================================

/**
 * Mints the short-lived Supabase access token that carries a tool call's
 * database access.
 *
 * This is the heart of the security model: PostgREST validates the signature
 * with the project's JWT secret and then evaluates RLS with `auth.uid()` = sub
 * and `auth.email()` = email. Because `public.is_allowed_user()` -- the only
 * predicate in every health policy -- checks exactly those two claims, an MCP
 * tool sees precisely what the same user sees in the browser, no more. The
 * service-role key is never used for health data.
 */
export function mintSupabaseUserJwt(params: {
  userId: string;
  email: string;
  supabaseUrl: string;
  secret: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}): string {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? SUPABASE_JWT_TTL_SECONDS;

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: params.userId,
    email: params.email,
    role: "authenticated",
    aud: "authenticated",
    iss: `${params.supabaseUrl.replace(/\/+$/, "")}/auth/v1`,
    iat: now,
    exp: now + ttl,
    app_metadata: { provider: "mcp" },
    user_metadata: {},
  };

  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlEncode(
    createHmac("sha256", params.secret).update(signingInput).digest(),
  );

  return `${signingInput}.${signature}`;
}
