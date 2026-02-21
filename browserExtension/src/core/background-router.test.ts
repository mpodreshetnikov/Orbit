import { describe, expect, it, vi } from "vitest";
import { routeBackgroundMessage } from "./background-router.js";

describe("background-router", () => {
  function createDeps() {
    return {
      sessionStore: {
        getSession: vi.fn(),
        setSession: vi.fn(),
      },
      importRunnerDeps: {
        getConnector: vi.fn(),
        callEdge: vi.fn(),
        broadcastToAppTabs: vi.fn(),
        nowIso: vi.fn(() => "2026-01-01T00:00:00.000Z"),
      },
    };
  }

  it("handles ping + unsupported message", async () => {
    const deps = createDeps();
    await expect(routeBackgroundMessage({ type: "MONEY_IMPORT_PING" }, deps)).resolves.toEqual({
      ok: true,
    });
    await expect(routeBackgroundMessage({ type: "UNKNOWN" }, deps)).resolves.toEqual({
      ok: false,
      error: "Unsupported message type",
    });
  });

  it("starts and gets session", async () => {
    const deps = createDeps();
    deps.sessionStore.getSession.mockResolvedValue({ source: "tbank_web" });

    await expect(
      routeBackgroundMessage(
        { type: "MONEY_IMPORT_START_SESSION", session: { source: "tbank_web" } },
        deps,
      ),
    ).resolves.toEqual({ ok: true });
    expect(deps.sessionStore.setSession).toHaveBeenCalledWith({ source: "tbank_web" });

    await expect(
      routeBackgroundMessage({ type: "MONEY_IMPORT_GET_SESSION" }, deps),
    ).resolves.toEqual({
      ok: true,
      session: { source: "tbank_web" },
    });
  });

  it("fails run when session is missing", async () => {
    const deps = createDeps();
    deps.sessionStore.getSession.mockResolvedValue(null);

    await expect(routeBackgroundMessage({ type: "MONEY_IMPORT_RUN" }, deps)).rejects.toThrow(
      "No active import session",
    );
  });
});
