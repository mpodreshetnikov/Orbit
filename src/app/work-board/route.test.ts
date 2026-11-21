import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUserMock,
  resolveWorkBoardAccessMock,
  loadWorkBoardCardsMock,
  clearWorkBoardCacheMock,
  renderBoardHtmlMock,
  getRequestOriginMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  resolveWorkBoardAccessMock: vi.fn(),
  loadWorkBoardCardsMock: vi.fn(),
  clearWorkBoardCacheMock: vi.fn(),
  renderBoardHtmlMock: vi.fn(),
  getRequestOriginMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/work-board/access", () => ({
  WORK_BOARD_ALLOWED_EMAIL: "mpodreshetnikov@gmail.com",
  resolveWorkBoardAccess: resolveWorkBoardAccessMock,
}));

vi.mock("@/lib/work-board/fetch-registry", () => ({
  clearWorkBoardCache: clearWorkBoardCacheMock,
  loadWorkBoardCards: loadWorkBoardCardsMock,
}));

vi.mock("@/lib/work-board/render", () => ({
  renderBoardHtml: renderBoardHtmlMock,
}));

vi.mock("@/lib/request-origin", () => ({
  getRequestOrigin: getRequestOriginMock,
}));

describe("GET /work-board", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    resolveWorkBoardAccessMock.mockReset();
    loadWorkBoardCardsMock.mockReset();
    clearWorkBoardCacheMock.mockReset();
    renderBoardHtmlMock.mockReset();
    getRequestOriginMock.mockReset();
    getRequestOriginMock.mockReturnValue("https://privateorbit.space");
  });

  it("returns 404 when the env flag is off", async () => {
    getCurrentUserMock.mockResolvedValue({ email: "mpodreshetnikov@gmail.com" });
    resolveWorkBoardAccessMock.mockReturnValue("not-found");
    const { GET } = await import("./route");
    const response = await GET(new Request("http://0.0.0.0:3000/work-board"));
    expect(response.status).toBe(404);
    expect(resolveWorkBoardAccessMock).toHaveBeenCalledWith({
      email: "mpodreshetnikov@gmail.com",
    });
  });

  it("redirects other emails to the public access-denied origin", async () => {
    getCurrentUserMock.mockResolvedValue({ email: "other@example.com" });
    resolveWorkBoardAccessMock.mockReturnValue("forbidden");
    const { GET } = await import("./route");
    const response = await GET(new Request("http://0.0.0.0:3000/work-board"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://privateorbit.space/access-denied");
    expect(getRequestOriginMock).toHaveBeenCalled();
  });

  it("redirects unauthenticated users to the public login origin", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    resolveWorkBoardAccessMock.mockReturnValue("unauthenticated");
    const { GET } = await import("./route");
    const response = await GET(new Request("http://0.0.0.0:3000/work-board"));
    expect(resolveWorkBoardAccessMock).toHaveBeenCalledWith({ email: null });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://privateorbit.space/login?redirect=%2Fwork-board",
    );
  });

  it("returns HTML for the allowed email and wires render options", async () => {
    getCurrentUserMock.mockResolvedValue({ email: "mpodreshetnikov@gmail.com" });
    resolveWorkBoardAccessMock.mockReturnValue("allow");
    loadWorkBoardCardsMock.mockResolvedValue({
      cards: [{ id: "T-1" }],
      generatedAt: "2026-11-21 12:00 UTC",
      source: "github",
      cacheHit: false,
    });
    renderBoardHtmlMock.mockReturnValue("<!DOCTYPE html><html><body>board</body></html>");

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/work-board"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("board");
    expect(clearWorkBoardCacheMock).not.toHaveBeenCalled();
    expect(renderBoardHtmlMock).toHaveBeenCalledWith([{ id: "T-1" }], {
      generatedAt: "2026-11-21 12:00 UTC (github, fresh)",
      reviewers: ["mpodreshetnikov@gmail.com"],
      lang: "ru",
    });
  });

  it("clears cache on refresh=1 and labels cache hits", async () => {
    getCurrentUserMock.mockResolvedValue({ email: "mpodreshetnikov@gmail.com" });
    resolveWorkBoardAccessMock.mockReturnValue("allow");
    loadWorkBoardCardsMock.mockResolvedValue({
      cards: [],
      generatedAt: "2026-11-21 12:00 UTC",
      source: "local-dir",
      cacheHit: true,
    });
    renderBoardHtmlMock.mockReturnValue("<html>ok</html>");

    const { GET } = await import("./route");
    const refreshed = await GET(new Request("http://localhost/work-board?refresh=1"));
    expect(refreshed.status).toBe(200);
    expect(await refreshed.text()).toBe("<html>ok</html>");
    expect(clearWorkBoardCacheMock).toHaveBeenCalledTimes(1);
    expect(renderBoardHtmlMock).toHaveBeenCalledWith([], {
      generatedAt: "2026-11-21 12:00 UTC (local-dir, cache)",
      reviewers: ["mpodreshetnikov@gmail.com"],
      lang: "ru",
    });

    clearWorkBoardCacheMock.mockClear();
    const plain = await GET(new Request("http://localhost/work-board?refresh=0"));
    expect(plain.status).toBe(200);
    expect(clearWorkBoardCacheMock).not.toHaveBeenCalled();
  });

  it("returns 503 with escaped error HTML when the RO token path fails", async () => {
    getCurrentUserMock.mockResolvedValue({ email: "mpodreshetnikov@gmail.com" });
    resolveWorkBoardAccessMock.mockReturnValue("allow");
    loadWorkBoardCardsMock.mockRejectedValue(new Error('missing <token> & "x"'));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/work-board"));
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).toContain("ORBIT_TASKS_GITHUB_TOKEN");
    expect(body).toContain("missing &lt;token&gt; &amp; &quot;x&quot;");
    expect(body).not.toContain("<token>");
  });

  it("stringifies non-Error failures in the 503 body", async () => {
    getCurrentUserMock.mockResolvedValue({ email: "mpodreshetnikov@gmail.com" });
    resolveWorkBoardAccessMock.mockReturnValue("allow");
    loadWorkBoardCardsMock.mockRejectedValue("raw-fail");

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/work-board"));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Failed to load work board");
  });
});
