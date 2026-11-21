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
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://privateorbit.space/login?redirect=%2Fwork-board",
    );
  });

  it("returns HTML for the allowed email", async () => {
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
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("board");
  });

  it("returns 503 when the RO token path fails", async () => {
    getCurrentUserMock.mockResolvedValue({ email: "mpodreshetnikov@gmail.com" });
    resolveWorkBoardAccessMock.mockReturnValue("allow");
    loadWorkBoardCardsMock.mockRejectedValue(new Error("ORBIT_TASKS_GITHUB_TOKEN is missing"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/work-board"));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("ORBIT_TASKS_GITHUB_TOKEN");
  });
});
