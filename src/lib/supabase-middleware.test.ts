import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRefs = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  next: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockRefs.createServerClient(...args),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: (...args: unknown[]) => mockRefs.next(...args),
    redirect: (...args: unknown[]) => mockRefs.redirect(...args),
  },
}));

function createRequest(pathname: string) {
  const parsed = new URL(`https://app.test${pathname}`);
  const createNextUrl = (p: string, search: string) => {
    const nextUrl: {
      pathname: string;
      searchParams: URLSearchParams;
      clone: () => unknown;
      toString: () => string;
    } = {
      pathname: p,
      searchParams: new URLSearchParams(search),
      clone: () => createNextUrl(nextUrl.pathname, nextUrl.searchParams.toString()),
      toString: () =>
        `https://app.test${nextUrl.pathname}${nextUrl.searchParams.toString() ? `?${nextUrl.searchParams.toString()}` : ""}`,
    };
    return nextUrl;
  };
  const nextUrl = createNextUrl(parsed.pathname, parsed.searchParams.toString());
  const cookieSet = vi.fn();
  return {
    request: {
      nextUrl,
      cookies: {
        getAll: vi.fn(() => []),
        set: cookieSet,
      },
    } as unknown as NextRequest,
    cookieSet,
  };
}

function createSupabase({
  user,
  allowedUser,
  invokeSetAll,
}: {
  user: { id: string; email?: string | null } | null;
  allowedUser?: Record<string, unknown> | null;
  invokeSetAll?: boolean;
}) {
  const allowlistBuilder = {
    select: vi.fn(),
    or: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: allowedUser ?? null, error: null }),
  };
  allowlistBuilder.select.mockReturnValue(allowlistBuilder);
  allowlistBuilder.or.mockReturnValue(allowlistBuilder);

  mockRefs.createServerClient.mockImplementation(
    (
      _url: string,
      _anon: string,
      options: {
        cookies: {
          setAll: (
            cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
          ) => void;
        };
      },
    ) => {
      if (invokeSetAll) {
        options.cookies.setAll([{ name: "sb", value: "token", options: { path: "/" } }]);
      }
      return {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user } }),
        },
        from: vi.fn(() => allowlistBuilder),
      };
    },
  );
}

describe("updateSession", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRefs.createServerClient.mockReset();
    mockRefs.next.mockReset();
    mockRefs.redirect.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mockRefs.next.mockImplementation(({ request }: { request: unknown }) => ({
      kind: "next",
      request,
      cookies: {
        set: vi.fn(),
      },
    }));
    mockRefs.redirect.mockImplementation((url: URL) => ({
      kind: "redirect",
      url: url.toString(),
    }));
  });

  it("returns next response for public route when unauthenticated", async () => {
    const { request } = createRequest("/login");
    createSupabase({
      user: null,
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "next" }));
    expect(mockRefs.redirect).not.toHaveBeenCalled();
  });

  it("returns next response for dev login route when unauthenticated", async () => {
    const { request } = createRequest("/auth/dev-login");
    createSupabase({
      user: null,
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "next" }));
    expect(mockRefs.redirect).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated user from protected route to login", async () => {
    const { request } = createRequest("/health/records");
    createSupabase({
      user: null,
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "redirect" }));
    expect(mockRefs.redirect).toHaveBeenCalledTimes(1);
    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/login");
    expect(redirectedUrl.searchParams.get("redirect")).toBe("/health/records");
  });

  it("redirects protected route to access denied when user is not allowlisted", async () => {
    const { request } = createRequest("/health");
    createSupabase({
      user: { id: "user-1", email: "u@example.com" },
      allowedUser: null,
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "redirect" }));
    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/access-denied");
  });

  it("redirects allowlisted login user to /health", async () => {
    const { request } = createRequest("/login");
    createSupabase({
      user: { id: "user-1", email: "u@example.com" },
      allowedUser: { id: "allowed-1" },
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "redirect" }));
    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/health");
  });

  it("keeps login user on page when not allowlisted and applies cookie setAll", async () => {
    const { request, cookieSet } = createRequest("/login");
    createSupabase({
      user: { id: "user-1", email: "u@example.com" },
      allowedUser: null,
      invokeSetAll: true,
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "next" }));
    expect(mockRefs.next).toHaveBeenCalledTimes(2);
    expect(cookieSet).toHaveBeenCalledWith("sb", "token");
  });
});
