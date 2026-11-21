import { describe, expect, it } from "vitest";
import { formatMcpServerTiming, withServerTimingHeader } from "./server-timing";

describe("MCP Server-Timing", () => {
  it("formats auth, mcp and total durations in milliseconds", () => {
    expect(formatMcpServerTiming({ authMs: 12.34, mcpMs: 3.5, totalMs: 16 })).toBe(
      "auth;dur=12.3, mcp;dur=3.5, total;dur=16.0",
    );
  });

  it("clamps negative durations to zero", () => {
    expect(formatMcpServerTiming({ authMs: -1, mcpMs: -2, totalMs: -3 })).toBe(
      "auth;dur=0.0, mcp;dur=0.0, total;dur=0.0",
    );
  });

  it("attaches Server-Timing and exposes it when no expose header exists", () => {
    const response = withServerTimingHeader(new Response("ok", { status: 200 }), {
      authMs: 1,
      mcpMs: 2,
      totalMs: 3,
    });
    expect(response.headers.get("Server-Timing")).toBe("auth;dur=1.0, mcp;dur=2.0, total;dur=3.0");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("Server-Timing");
  });

  it("appends Server-Timing to an existing expose list", () => {
    const response = withServerTimingHeader(
      new Response("ok", {
        status: 200,
        headers: { "Access-Control-Expose-Headers": "ETag, Content-Length" },
      }),
      { authMs: 0, mcpMs: 1, totalMs: 1 },
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
      "ETag, Content-Length, Server-Timing",
    );
  });

  it("does not duplicate Server-Timing in the expose list", () => {
    const response = withServerTimingHeader(
      new Response("ok", {
        status: 201,
        headers: { "Access-Control-Expose-Headers": "server-timing, ETag" },
      }),
      { authMs: 4, mcpMs: 5, totalMs: 9 },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("server-timing, ETag");
  });

  it("trims spaced expose tokens before matching Server-Timing", () => {
    const response = withServerTimingHeader(
      new Response("ok", {
        status: 200,
        // Trailing spaces around tokens; Headers may trim the overall value.
        headers: { "Access-Control-Expose-Headers": "Server-Timing , ETag" },
      }),
      { authMs: 0, mcpMs: 1, totalMs: 1 },
    );
    const exposed = response.headers.get("Access-Control-Expose-Headers") ?? "";
    // Without per-token trim, "server-timing " would miss and append a duplicate.
    expect(
      exposed
        .toLowerCase()
        .split(",")
        .filter((p) => p.trim() === "server-timing"),
    ).toHaveLength(1);
    expect(exposed).not.toMatch(/Server-Timing.*,\s*Server-Timing/i);
  });
});
