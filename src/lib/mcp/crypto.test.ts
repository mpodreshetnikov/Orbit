import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  createConsentToken,
  generateClientId,
  generateToken,
  mintSupabaseUserJwt,
  sha256Hex,
  timingSafeEqualHex,
  verifyConsentToken,
  verifyPkceS256,
  type ConsentTokenPayload,
} from "./crypto";

// Low-entropy on purpose: a realistic-looking random string here trips the
// gitleaks generic-api-key rule in CI, and a fixture is not worth an allowlist
// entry that would weaken secret scanning across the whole repo.
const SECRET = "test-test-test-test-test-test-test-test";

function pkcePair(verifier: string) {
  return {
    verifier,
    challenge: base64UrlEncode(createHash("sha256").update(verifier).digest()),
  };
}

const VALID_VERIFIER = "a".repeat(64);

describe("generateToken", () => {
  it("returns distinct 256-bit base64url values", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });
});

describe("generateClientId", () => {
  it("is prefixed and unique", () => {
    const a = generateClientId();
    const b = generateClientId();
    expect(a).toMatch(/^mcp_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("sha256Hex / timingSafeEqualHex", () => {
  it("hashes deterministically", () => {
    expect(sha256Hex("token")).toBe(sha256Hex("token"));
    expect(sha256Hex("token")).not.toBe(sha256Hex("token2"));
    expect(sha256Hex("token")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compares equal digests as equal and different digests as different", () => {
    expect(timingSafeEqualHex(sha256Hex("a"), sha256Hex("a"))).toBe(true);
    expect(timingSafeEqualHex(sha256Hex("a"), sha256Hex("b"))).toBe(false);
  });

  it("rejects empty and mismatched-length input rather than throwing", () => {
    expect(timingSafeEqualHex("", "")).toBe(false);
    expect(timingSafeEqualHex("ab", sha256Hex("a"))).toBe(false);
  });
});

describe("verifyPkceS256", () => {
  it("accepts a verifier matching its challenge", () => {
    const { verifier, challenge } = pkcePair(VALID_VERIFIER);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    const { challenge } = pkcePair(VALID_VERIFIER);
    expect(verifyPkceS256("b".repeat(64), challenge)).toBe(false);
  });

  it("rejects a plain (unhashed) challenge, so downgrade to PKCE plain is impossible", () => {
    expect(verifyPkceS256(VALID_VERIFIER, VALID_VERIFIER)).toBe(false);
  });

  it.each([
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(129)],
    ["disallowed characters", `${"a".repeat(60)}+/=!`],
  ])("rejects a verifier that is %s", (_label, verifier) => {
    const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
    expect(verifyPkceS256(verifier, challenge)).toBe(false);
  });
});

describe("consent token", () => {
  const payload: ConsentTokenPayload = {
    clientId: "mcp_abc",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    scope: "health:read health:write",
    state: "state-1",
    codeChallenge: "challenge-1",
    resource: "https://app.test/api/mcp",
  };

  it("round-trips an untampered payload", () => {
    const token = createConsentToken(payload, SECRET, 1000);
    expect(verifyConsentToken(token, payload, SECRET, 1000)).toBe(true);
  });

  it.each([
    ["clientId", { clientId: "mcp_other" }],
    ["redirectUri", { redirectUri: "https://evil.example/cb" }],
    ["scope", { scope: "health:read health:write admin" }],
    ["state", { state: "state-2" }],
    ["codeChallenge", { codeChallenge: "challenge-2" }],
    ["resource", { resource: "https://evil.example/api/mcp" }],
  ])("rejects a payload whose %s was tampered with", (_field, override) => {
    const token = createConsentToken(payload, SECRET, 1000);
    expect(verifyConsentToken(token, { ...payload, ...override }, SECRET, 1000)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = createConsentToken(payload, SECRET, 1000);
    expect(verifyConsentToken(token, payload, SECRET, 1000 + 601)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createConsentToken(payload, "other-secret", 1000);
    expect(verifyConsentToken(token, payload, SECRET, 1000)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyConsentToken("", payload, SECRET, 1000)).toBe(false);
    expect(verifyConsentToken("nodot", payload, SECRET, 1000)).toBe(false);
    expect(verifyConsentToken("notanumber.abcd", payload, SECRET, 1000)).toBe(false);
  });
});

describe("mintSupabaseUserJwt", () => {
  const params = {
    userId: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    supabaseUrl: "https://project.supabase.co",
    secret: "super-secret-jwt-key",
    nowSeconds: 1_700_000_000,
  };

  function decode(jwt: string) {
    const [header, payload, signature] = jwt.split(".");
    return {
      header: JSON.parse(Buffer.from(header, "base64url").toString()),
      payload: JSON.parse(Buffer.from(payload, "base64url").toString()),
      signature,
      signingInput: `${header}.${payload}`,
    };
  }

  it("emits the claims Supabase RLS depends on", () => {
    const { header, payload } = decode(mintSupabaseUserJwt(params));

    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    // auth.uid() reads `sub` and auth.email() reads `email`; is_allowed_user()
    // checks both, so these two claims are what make RLS behave as in-browser.
    expect(payload.sub).toBe(params.userId);
    expect(payload.email).toBe(params.email);
    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
    expect(payload.iss).toBe("https://project.supabase.co/auth/v1");
  });

  it("expires in five minutes", () => {
    const { payload } = decode(mintSupabaseUserJwt(params));
    expect(payload.iat).toBe(params.nowSeconds);
    expect(payload.exp - payload.iat).toBe(300);
  });

  it("produces a signature verifiable with the shared secret", () => {
    const { signature, signingInput } = decode(mintSupabaseUserJwt(params));
    const expected = createHmac("sha256", params.secret).update(signingInput).digest("base64url");
    expect(signature).toBe(expected);
  });

  it("does not verify under a different secret", () => {
    const { signature, signingInput } = decode(mintSupabaseUserJwt(params));
    const wrong = createHmac("sha256", "wrong").update(signingInput).digest("base64url");
    expect(signature).not.toBe(wrong);
  });

  it("normalizes a trailing slash on the Supabase URL", () => {
    const { payload } = decode(
      mintSupabaseUserJwt({ ...params, supabaseUrl: "https://project.supabase.co/" }),
    );
    expect(payload.iss).toBe("https://project.supabase.co/auth/v1");
  });
});
