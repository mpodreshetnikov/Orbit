import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

describe("GET /auth/callback", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
  });

  it("redirects to /login when code is missing", async () => {
    const { GET } = await import("./route");
    const request = {
      url: "http://localhost/auth/callback",
      cookies: {
        getAll: () => [],
      },
    } as never;

    const response = await GET(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("exchanges auth code and redirects to next path", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue(undefined);
    const verifyOtp = vi.fn();
    createServerClientMock.mockReturnValue({
      auth: {
        exchangeCodeForSession,
        verifyOtp,
      },
    });

    const { GET } = await import("./route");
    const request = {
      url: "http://localhost/auth/callback?code=abc123&next=/settings",
      cookies: {
        getAll: () => [],
      },
    } as never;

    const response = await GET(request);

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/settings");
  });

  it("verifies token hash and redirects to next path", async () => {
    const exchangeCodeForSession = vi.fn();
    const verifyOtp = vi.fn().mockResolvedValue(undefined);
    createServerClientMock.mockReturnValue({
      auth: {
        exchangeCodeForSession,
        verifyOtp,
      },
    });

    const { GET } = await import("./route");
    const request = {
      url: "http://localhost/auth/callback?token_hash=hash123&type=magiclink&next=/money/import",
      cookies: {
        getAll: () => [],
      },
    } as never;

    const response = await GET(request);

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash123",
      type: "magiclink",
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/money/import");
  });

  it("sanitizes non-relative next path to /health", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue(undefined);
    const verifyOtp = vi.fn();
    createServerClientMock.mockReturnValue({
      auth: {
        exchangeCodeForSession,
        verifyOtp,
      },
    });

    const { GET } = await import("./route");
    const request = {
      url: "http://localhost/auth/callback?code=abc123&next=https://evil.example/phish",
      cookies: {
        getAll: () => [],
      },
    } as never;

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/health");
  });

  it("redirects to /login when token hash type is unsupported", async () => {
    const { GET } = await import("./route");
    const request = {
      url: "http://localhost/auth/callback?token_hash=hash123&type=unknown",
      cookies: {
        getAll: () => [],
      },
    } as never;

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });
});
