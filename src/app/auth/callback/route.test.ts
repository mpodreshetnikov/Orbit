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
    createServerClientMock.mockReturnValue({
      auth: {
        exchangeCodeForSession,
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
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/settings");
  });
});

