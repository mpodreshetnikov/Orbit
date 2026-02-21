import { describe, expect, it, vi } from "vitest";
import { runImportSession, tryCompleteSessionAsFailed } from "./import-runner.js";

describe("import-runner", () => {
  it("runs connector parse + apply + complete flow", async () => {
    const connector = {
      sourceId: "tbank_web",
      parse: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }],
        windowTo: "2026-02-20T00:00:00.000Z",
        parsedThroughAt: "2026-02-19T00:00:00.000Z",
        parsedTransactionsCount: 1,
      }),
    };

    const callEdge = vi
      .fn()
      .mockResolvedValueOnce({ batch_id: "batch-2" })
      .mockResolvedValueOnce({ ok: true });
    const broadcastToAppTabs = vi.fn().mockResolvedValue(undefined);

    const session = {
      source: "tbank_web",
      function_url: "https://example.com/fn",
      session_token: "token",
      session_id: "session-1",
      batch_id: "batch-1",
    };

    const result = await runImportSession(session, "2026-01-01T00:00:00.000Z", {
      getConnector: () => connector as never,
      callEdge,
      broadcastToAppTabs,
      nowIso: () => "2026-01-01T00:00:00.000Z",
    });

    expect(connector.parse).toHaveBeenCalledOnce();
    expect(callEdge).toHaveBeenCalledTimes(2);
    expect(broadcastToAppTabs).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ batch_id: "batch-2" });
  });

  it("swallows failure completion errors", async () => {
    const callEdge = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      tryCompleteSessionAsFailed(
        {
          function_url: "https://example.com/fn",
          session_token: "token",
          session_id: "session-1",
          batch_id: "batch-1",
        },
        callEdge,
      ),
    ).resolves.toBeUndefined();
  });
});
