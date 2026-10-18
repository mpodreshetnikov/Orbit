import { describe, expect, it } from "vitest";
import { getRequestOrigin } from "./request-origin";

describe("getRequestOrigin", () => {
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
