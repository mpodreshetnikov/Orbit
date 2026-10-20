import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequestOrigin } from "./request-origin";

describe("getRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured public origin and ignores what the request claims", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://orbit.example.com/");
    const request = new Request("https://0.0.0.0:3000/auth/callback", {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    });
    expect(getRequestOrigin(request)).toBe("https://orbit.example.com");
  });

  it("only sends the browser to http or https", () => {
    const request = new Request("https://0.0.0.0:3000/", {
      headers: { "x-forwarded-host": "orbit.example.com", "x-forwarded-proto": "javascript" },
    });
    expect(getRequestOrigin(request)).toBe("https://orbit.example.com");
  });

  it("prefers the proxy's forwarded host over the address the server listens on", () => {
    const request = new Request("https://0.0.0.0:3000/auth/callback", {
      headers: { "x-forwarded-host": "orbit.example.com", "x-forwarded-proto": "https" },
    });
    expect(getRequestOrigin(request)).toBe("https://orbit.example.com");
  });

  it("reads the standard Forwarded header", () => {
    const request = new Request("http://0.0.0.0:3000/", {
      headers: { forwarded: 'for=1.2.3.4;host="orbit.example.com";proto=https' },
    });
    expect(getRequestOrigin(request)).toBe("https://orbit.example.com");
  });

  it("falls back to the request URL without a proxy", () => {
    expect(getRequestOrigin(new Request("http://localhost:3000/x"))).toBe("http://localhost:3000");
    expect(getRequestOrigin({ url: "http://localhost/auth/callback" })).toBe("http://localhost");
  });
});
