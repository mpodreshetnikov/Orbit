import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

describe("POST /auth/signout", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
  });

  it("signs out and redirects to /login", async () => {
    const signOutMock = vi.fn().mockResolvedValue(undefined);
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        signOut: signOutMock,
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/auth/signout", {
        method: "POST",
      }) as never,
    );

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });
});

