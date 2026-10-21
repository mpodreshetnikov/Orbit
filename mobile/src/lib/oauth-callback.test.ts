import { describe, expect, it } from "vitest";
import { parseOAuthCallback } from "@/lib/oauth-callback";

describe("parseOAuthCallback", () => {
  it("returns the code from an Expo Go redirect", () => {
    expect(parseOAuthCallback("exp://192.168.1.5:8081/--/auth/callback?code=abc")).toEqual({
      code: "abc",
    });
  });

  it("returns the code from the app's own scheme", () => {
    expect(parseOAuthCallback("orbit://auth/callback?code=abc")).toEqual({ code: "abc" });
  });

  it("prefers the instance's explanation over a bare error code", () => {
    expect(
      parseOAuthCallback(
        "orbit://auth/callback?error=access_denied&error_description=Email+not+allowed",
      ),
    ).toEqual({ error: "Email not allowed" });
  });

  it("reads an error GoTrue put in the fragment", () => {
    expect(parseOAuthCallback("orbit://auth/callback#error=server_error")).toEqual({
      error: "server_error",
    });
  });

  it("refuses a redirect with neither a code nor an error", () => {
    expect(parseOAuthCallback("orbit://auth/callback")).toEqual({
      error: "The sign-in finished without an authorisation code.",
    });
  });

  it("refuses something that is not a URL", () => {
    expect(parseOAuthCallback("not a url")).toHaveProperty("error");
  });
});
