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
      search: string;
      clone: () => unknown;
      toString: () => string;
    } = {
      pathname: p,
      searchParams: new URLSearchParams(search),
      // Mirrors NextURL: `search` is the serialized form of `searchParams`, and
      // assigning to it replaces them wholesale.
      get search() {
        const serialized = nextUrl.searchParams.toString();
        return serialized ? `?${serialized}` : "";
      },
      set search(value: string) {
        nextUrl.searchParams = new URLSearchParams(value);
      },
      clone: () => createNextUrl(nextUrl.pathname, nextUrl.searchParams.toString()),
      toString: () => `https://app.test${nextUrl.pathname}${nextUrl.search}`,
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

  it("preserves the query string when redirecting an unauthenticated user to login", async () => {
    const { request } = createRequest(
      "/oauth/authorize?client_id=mcp_abc&code_challenge=xyz&state=s1",
    );
    createSupabase({ user: null });

    const { updateSession } = await import("./supabase-middleware");
    await updateSession(request);

    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/login");
    expect(redirectedUrl.searchParams.get("redirect")).toBe(
      "/oauth/authorize?client_id=mcp_abc&code_challenge=xyz&state=s1",
    );
    // The inbound OAuth parameters must not leak onto /login itself.
    expect(redirectedUrl.searchParams.get("client_id")).toBeNull();
    expect(redirectedUrl.searchParams.get("state")).toBeNull();
  });

  it.each(["/api/mcp", "/api/oauth/token", "/.well-known/oauth-authorization-server"])(
    "does not redirect bearer-authenticated route %s when unauthenticated",
    async (pathname) => {
      const { request } = createRequest(pathname);
      createSupabase({ user: null });

      const { updateSession } = await import("./supabase-middleware");
      const response = await updateSession(request);

      expect(response).toEqual(expect.objectContaining({ kind: "next" }));
      expect(mockRefs.redirect).not.toHaveBeenCalled();
      // These routes must not pay for a session round-trip either.
      expect(mockRefs.createServerClient).not.toHaveBeenCalled();
    },
  );

  it("still gates /oauth/authorize behind login", async () => {
    const { request } = createRequest("/oauth/authorize");
    createSupabase({ user: null });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "redirect" }));
  });

  it("carries the query string into the dev login next parameter", async () => {
    vi.stubEnv("DEV_AUTH_BYPASS_ENABLED", "1");
    vi.stubEnv("DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED", "1");
    vi.stubEnv("DEV_AUTH_BYPASS_DEFAULT_EMAIL", "dev@example.com");
    const { request } = createRequest("/oauth/authorize?client_id=mcp_abc&state=s1");
    createSupabase({ user: null });

    const { updateSession } = await import("./supabase-middleware");
    await updateSession(request);

    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/auth/dev-login");
    expect(redirectedUrl.searchParams.get("next")).toBe(
      "/oauth/authorize?client_id=mcp_abc&state=s1",
    );
    expect(redirectedUrl.searchParams.get("client_id")).toBeNull();
  });

  it("sends an allowlisted user on /login to their requested destination", async () => {
    const { request } = createRequest("/login?redirect=%2Foauth%2Fauthorize%3Fclient_id%3Dmcp_abc");
    createSupabase({
      user: { id: "user-1", email: "u@example.com" },
      allowedUser: { id: "allowed-1" },
    });

    const { updateSession } = await import("./supabase-middleware");
    await updateSession(request);

    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/oauth/authorize");
    expect(redirectedUrl.searchParams.get("client_id")).toBe("mcp_abc");
  });

  it("ignores an off-site redirect target on /login", async () => {
    const { request } = createRequest("/login?redirect=%2F%2Fevil.example%2Fsteal");
    createSupabase({
      user: { id: "user-1", email: "u@example.com" },
      allowedUser: { id: "allowed-1" },
    });

    const { updateSession } = await import("./supabase-middleware");
    await updateSession(request);

    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.host).toBe("app.test");
    expect(redirectedUrl.pathname).toBe("/health");
  });

  it("redirects unauthenticated protected routes to dev login in auto bypass mode", async () => {
    vi.stubEnv("DEV_AUTH_BYPASS_ENABLED", "1");
    vi.stubEnv("DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED", "1");
    vi.stubEnv("DEV_AUTH_BYPASS_DEFAULT_EMAIL", "dev@example.com");
    const { request } = createRequest("/health/records");
    createSupabase({
      user: null,
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "redirect" }));
    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/auth/dev-login");
    expect(redirectedUrl.searchParams.get("email")).toBe("dev@example.com");
    expect(redirectedUrl.searchParams.get("next")).toBe("/health/records");
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

  it("redirects unauthenticated login route to dev login in auto bypass mode", async () => {
    vi.stubEnv("DEV_AUTH_BYPASS_ENABLED", "1");
    vi.stubEnv("DEV_AUTH_BYPASS_AUTO_LOGIN_ENABLED", "1");
    vi.stubEnv("DEV_AUTH_BYPASS_DEFAULT_EMAIL", "dev@example.com");
    const { request } = createRequest("/login?redirect=/money/import");
    createSupabase({
      user: null,
    });

    const { updateSession } = await import("./supabase-middleware");
    const response = await updateSession(request);

    expect(response).toEqual(expect.objectContaining({ kind: "redirect" }));
    const redirectedUrl = new URL((mockRefs.redirect.mock.calls[0] as [URL])[0].toString());
    expect(redirectedUrl.pathname).toBe("/auth/dev-login");
    expect(redirectedUrl.searchParams.get("email")).toBe("dev@example.com");
    expect(redirectedUrl.searchParams.get("next")).toBe("/money/import");
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
