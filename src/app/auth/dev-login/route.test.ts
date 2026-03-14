import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe("GET /auth/dev-login", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_BYPASS_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  it("redirects to /login when bypass is disabled", async () => {
    vi.stubEnv("DEV_AUTH_BYPASS_ENABLED", "0");

    const { GET } = await import("./route");
    const response = await GET({
      url: "http://localhost/auth/dev-login?email=dev@example.com",
    } as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects invalid email", async () => {
    const { GET } = await import("./route");
    const response = await GET({
      url: "http://localhost/auth/dev-login?email=not-an-email",
    } as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("uses the default bypass user when auto-login is enabled and email is omitted", async () => {
    vi.stubEnv("DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED", "1");
    vi.stubEnv("DEV_AUTH_BYPASS_DEFAULT_EMAIL", "dev@example.com");

    const createUser = vi.fn().mockResolvedValue({ error: null });
    const generateLink = vi.fn().mockResolvedValue({
      data: {
        properties: {
          hashed_token: "hash-default",
        },
      },
      error: null,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });

    createClientMock.mockReturnValue({
      auth: {
        admin: {
          createUser,
          generateLink,
        },
      },
      from: vi.fn(() => ({
        upsert,
      })),
    });

    const { GET } = await import("./route");
    const response = await GET({
      url: "http://localhost/auth/dev-login?next=/money/transactions",
    } as never);

    expect(createUser).toHaveBeenCalledWith({
      email: "dev@example.com",
      email_confirm: true,
    });
    expect(upsert).toHaveBeenCalledWith(
      { email: "dev@example.com" },
      { onConflict: "email" },
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("token_hash=hash-default");
    expect(response.headers.get("location")).toContain("next=%2Fmoney%2Ftransactions");
  });

  it("creates/allowlists user and redirects with token hash", async () => {
    const createUser = vi.fn().mockResolvedValue({ error: null });
    const generateLink = vi.fn().mockResolvedValue({
      data: {
        properties: {
          hashed_token: "hash123",
        },
      },
      error: null,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });

    createClientMock.mockReturnValue({
      auth: {
        admin: {
          createUser,
          generateLink,
        },
      },
      from: vi.fn(() => ({
        upsert,
      })),
    });

    const { GET } = await import("./route");
    const response = await GET({
      url: "http://localhost/auth/dev-login?email=Dev.User@example.com&next=https://evil.example/x",
    } as never);

    expect(createUser).toHaveBeenCalledWith({
      email: "dev.user@example.com",
      email_confirm: true,
    });
    expect(upsert).toHaveBeenCalledWith({ email: "dev.user@example.com" }, { onConflict: "email" });

    const redirectUrl = new URL(response.headers.get("location")!);
    expect(redirectUrl.pathname).toBe("/auth/callback");
    expect(redirectUrl.searchParams.get("token_hash")).toBe("hash123");
    expect(redirectUrl.searchParams.get("type")).toBe("magiclink");
    expect(redirectUrl.searchParams.get("next")).toBe("/health");
  });

  it("tolerates already-registered user creation error", async () => {
    const createUser = vi.fn().mockResolvedValue({
      error: { message: "A user with this email address has already been registered" },
    });
    const generateLink = vi.fn().mockResolvedValue({
      data: {
        properties: {
          hashed_token: "hash456",
        },
      },
      error: null,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });

    createClientMock.mockReturnValue({
      auth: {
        admin: {
          createUser,
          generateLink,
        },
      },
      from: vi.fn(() => ({
        upsert,
      })),
    });

    const { GET } = await import("./route");
    const response = await GET({
      url: "http://localhost/auth/dev-login?email=existing@example.com&next=/money/import",
    } as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("token_hash=hash456");
  });
});
