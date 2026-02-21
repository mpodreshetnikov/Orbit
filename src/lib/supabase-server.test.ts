import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock, cookiesMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

describe("supabase-server helpers", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    cookiesMock.mockReset();
    cookiesMock.mockResolvedValue({
      getAll: () => [],
      set: vi.fn(),
    });
  });

  it("getCurrentUser returns null when auth user lookup fails", async () => {
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("unauthorized"),
        }),
      },
    });

    const { getCurrentUser } = await import("./supabase-server");
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("isUserAllowed returns false for unauthenticated user", async () => {
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("unauthorized"),
        }),
      },
    });

    const { isUserAllowed } = await import("./supabase-server");
    await expect(isUserAllowed()).resolves.toBe(false);
  });

  it("isUserAllowed returns true for allowlisted user", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "allow-1" },
      error: null,
    });
    const or = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ or }));

    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "auth-user-1", email: "user@example.com" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({ select })),
    });

    const { isUserAllowed } = await import("./supabase-server");
    await expect(isUserAllowed()).resolves.toBe(true);
  });
});

