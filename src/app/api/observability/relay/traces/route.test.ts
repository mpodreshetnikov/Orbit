import { beforeEach, describe, expect, it, vi } from "vitest";

const { forwardTracesToOtlpMock, createServerLoggerMock } = vi.hoisted(() => ({
  forwardTracesToOtlpMock: vi.fn(),
  createServerLoggerMock: vi.fn(),
}));

vi.mock("@/lib/observability/otlp-traces", () => ({
  forwardTracesToOtlp: forwardTracesToOtlpMock,
}));

vi.mock("@/lib/observability/server-logger", () => ({
  createServerLogger: createServerLoggerMock,
}));

describe("POST /api/observability/relay/traces", () => {
  beforeEach(() => {
    forwardTracesToOtlpMock.mockReset();
    createServerLoggerMock.mockReset();
    createServerLoggerMock.mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
  });

  it("returns 400 for invalid json", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/observability/relay/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON payload." });
  });

  it("returns 413 for oversized payloads", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/observability/relay/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(256 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Payload too large." });
  });

  it("returns 400 for invalid shape", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/observability/relay/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foo: "bar" }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Expected payload shape");
  });

  it("returns 202 when OTLP forwarding fails", async () => {
    forwardTracesToOtlpMock.mockRejectedValueOnce(new Error("otlp down"));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/observability/relay/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              name: "web.test.span",
              app: "web",
              component: "test",
              env: "local",
              release: "dev",
              trace_id: "0123456789abcdef0123456789abcdef",
              span_id: "0123456789abcdef",
              request_id: "req_1",
              start_time: "2026-02-28T00:00:00.000Z",
              end_time: "2026-02-28T00:00:00.100Z",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      degraded: true,
      accepted: 1,
    });
  });

  it("returns 200 for valid span batch", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/observability/relay/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              name: "web.test.span",
              app: "web",
              component: "test",
              env: "local",
              release: "dev",
              trace_id: "0123456789abcdef0123456789abcdef",
              span_id: "0123456789abcdef",
              request_id: "req_1",
              start_time: "2026-02-28T00:00:00.000Z",
              end_time: "2026-02-28T00:00:00.100Z",
              kind: "client",
              status: "ok",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, accepted: 1 });
    expect(forwardTracesToOtlpMock).toHaveBeenCalledTimes(1);
  });
});
