import { describe, expect, it } from "vitest";
import { isUrlWithinHostPermissions, parseIncomingGrant } from "./grant-store.js";

const HOST_PERMISSIONS = ["https://vvriurabgusbdysfrcem.supabase.co/*"];
const FUNCTION_URL = "https://vvriurabgusbdysfrcem.supabase.co/functions/v1/money-import";
const NOW = "2026-09-01T12:00:00.000Z";

function grant(overrides: Record<string, unknown> = {}) {
  return {
    token: "plain-token",
    person_id: "person-1",
    allowed_sources: ["tbank_web"],
    function_url: FUNCTION_URL,
    app_origin: "https://orbit.example",
    ...overrides,
  };
}

describe("isUrlWithinHostPermissions", () => {
  it("accepts a url the extension already has permission for", () => {
    expect(isUrlWithinHostPermissions(FUNCTION_URL, HOST_PERMISSIONS)).toBe(true);
  });

  it("refuses another host, which is the whole point", () => {
    // The bridge listens on window.postMessage, so anything running on the app's page can send
    // a grant. An unchecked function_url is an address the token gets delivered to.
    expect(
      isUrlWithinHostPermissions(
        "https://attacker.example/functions/v1/money-import",
        HOST_PERMISSIONS,
      ),
    ).toBe(false);
  });

  it("refuses a lookalike host that merely ends with the permitted one", () => {
    expect(
      isUrlWithinHostPermissions(
        "https://evilvvriurabgusbdysfrcem.supabase.co/x",
        HOST_PERMISSIONS,
      ),
    ).toBe(false);
  });

  it("refuses plain http even on the permitted host", () => {
    expect(
      isUrlWithinHostPermissions("http://vvriurabgusbdysfrcem.supabase.co/x", HOST_PERMISSIONS),
    ).toBe(false);
  });

  it("refuses anything at all when the extension declares no host permissions", () => {
    expect(isUrlWithinHostPermissions(FUNCTION_URL, [])).toBe(false);
  });

  it("honours a wildcard subdomain pattern without matching the bare suffix", () => {
    const patterns = ["https://*.supabase.co/*"];
    expect(isUrlWithinHostPermissions("https://project.supabase.co/x", patterns)).toBe(true);
    expect(isUrlWithinHostPermissions("https://notsupabase.co/x", patterns)).toBe(false);
  });
});

describe("parseIncomingGrant", () => {
  it("reads a well-formed grant and stamps when it arrived", () => {
    const parsed = parseIncomingGrant(grant(), HOST_PERMISSIONS, NOW);
    expect(parsed).toEqual({
      token: "plain-token",
      person_id: "person-1",
      allowed_sources: ["tbank_web"],
      function_url: FUNCTION_URL,
      app_origin: "https://orbit.example",
      received_at: NOW,
    });
  });

  it("refuses a grant whose function_url is outside the host permissions", () => {
    expect(
      parseIncomingGrant(
        grant({ function_url: "https://attacker.example/f" }),
        HOST_PERMISSIONS,
        NOW,
      ),
    ).toBeNull();
  });

  it.each([
    ["no token", { token: "" }],
    ["whitespace token", { token: "   " }],
    ["no person", { person_id: "" }],
    ["no function url", { function_url: "" }],
    ["no sources", { allowed_sources: [] }],
    ["sources that are not strings", { allowed_sources: [{}, 3] }],
  ])("refuses a grant with %s", (_label, overrides) => {
    expect(parseIncomingGrant(grant(overrides), HOST_PERMISSIONS, NOW)).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(parseIncomingGrant(null, HOST_PERMISSIONS, NOW)).toBeNull();
    expect(parseIncomingGrant("token", HOST_PERMISSIONS, NOW)).toBeNull();
  });
});
