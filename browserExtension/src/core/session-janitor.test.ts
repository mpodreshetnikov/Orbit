import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./session-store.js";
import { createSessionJanitor, judgeStoredSession, RUN_STARTED_AT_KEY } from "./session-janitor.js";

const NOW = Date.parse("2026-09-04T06:00:00.000Z");

function memoryStorage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: async (keys: string[]) =>
      Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])),
    set: async (next: Record<string, unknown>) => {
      Object.assign(values, next);
    },
  };
}

describe("judgeStoredSession", () => {
  it("tells idle, running, expired and orphan apart", () => {
    const live = { session_id: "s1", expires_at: "2026-09-04T10:00:00.000Z" };
    expect(judgeStoredSession(live, { nowMs: NOW, runActive: false })).toBe("idle");
    expect(judgeStoredSession(live, { nowMs: NOW, runActive: true })).toBe("running");
    expect(
      judgeStoredSession(
        { ...live, [RUN_STARTED_AT_KEY]: NOW - 1000 },
        { nowMs: NOW, runActive: false },
      ),
    ).toBe("orphan");
    // Past its expiry nothing else matters, not even a run that thinks it holds it.
    expect(
      judgeStoredSession(
        { session_id: "s1", expires_at: "2026-09-03T09:38:16.275Z", [RUN_STARTED_AT_KEY]: 1 },
        { nowMs: NOW, runActive: true },
      ),
    ).toBe("expired");
    // No expiry stated: the server's word is unknown, so only the run decides.
    expect(judgeStoredSession({ session_id: "s1" }, { nowMs: NOW, runActive: false })).toBe("idle");
  });
});

describe("session janitor", () => {
  function createHarness(session: Record<string, unknown> | null, runActive = false) {
    const storage = memoryStorage();
    storage.values.extension_import_session = session;
    const completeAsFailed = vi.fn(async () => undefined);
    const events: Array<{ event: string; attrs: Record<string, unknown> }> = [];
    const janitor = createSessionJanitor({
      store: createSessionStore(storage),
      isRunActive: () => runActive,
      completeAsFailed,
      now: () => NOW,
      onInfo: (event, attrs) => events.push({ event, attrs }),
    });
    return { storage, janitor, completeAsFailed, events };
  }

  it("leaves an idle session to the person and a running one to its run", async () => {
    const idle = createHarness({ session_id: "s1", expires_at: "2026-09-04T10:00:00.000Z" });
    await expect(idle.janitor.reconcile("boot")).resolves.toBe("idle");
    await expect(idle.janitor.store.getSession()).resolves.toEqual({
      session_id: "s1",
      expires_at: "2026-09-04T10:00:00.000Z",
    });
    expect(idle.completeAsFailed).not.toHaveBeenCalled();

    const running = createHarness(
      { session_id: "s1", expires_at: "2026-09-04T10:00:00.000Z", [RUN_STARTED_AT_KEY]: NOW - 5 },
      true,
    );
    await expect(running.janitor.reconcile("read")).resolves.toBe("running");
    expect(running.storage.values.extension_import_session).not.toBeNull();
  });

  it("closes an orphan on the server and clears it, and no reader ever sees it", async () => {
    const harness = createHarness({
      session_id: "s-dead",
      batch_id: "b-dead",
      expires_at: "2026-09-04T10:00:00.000Z",
      [RUN_STARTED_AT_KEY]: NOW - 60_000,
    });

    await expect(harness.janitor.store.getSession()).resolves.toBeNull();
    expect(harness.completeAsFailed).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "s-dead", batch_id: "b-dead" }),
    );
    expect(harness.storage.values.extension_import_session).toBeNull();
    expect(harness.events).toEqual([
      {
        event: "money_import_stored_session_cleared",
        attrs: { reason: "read", verdict: "orphan", session_id: "s-dead", batch_id: "b-dead" },
      },
    ]);
  });

  it("clears an expired session without asking the server, which has closed it already", async () => {
    const harness = createHarness({ session_id: "s-old", expires_at: "2026-09-03T09:38:16.275Z" });
    await expect(harness.janitor.reconcile("boot")).resolves.toBe("expired");
    expect(harness.completeAsFailed).not.toHaveBeenCalled();
    expect(harness.storage.values.extension_import_session).toBeNull();
  });

  it("does not clear a session the app stored while the orphan was being closed", async () => {
    const harness = createHarness({
      session_id: "s-dead",
      expires_at: "2026-09-04T10:00:00.000Z",
      [RUN_STARTED_AT_KEY]: NOW - 60_000,
    });
    harness.completeAsFailed.mockImplementation(async () => {
      harness.storage.values.extension_import_session = {
        session_id: "s-new",
        expires_at: "2026-09-04T10:00:00.000Z",
      };
    });

    await expect(harness.janitor.reconcile("boot")).resolves.toBe("orphan");
    expect(harness.storage.values.extension_import_session).toEqual({
      session_id: "s-new",
      expires_at: "2026-09-04T10:00:00.000Z",
    });
  });

  it("marks the stored session as running only while it is the one given", async () => {
    const harness = createHarness({ session_id: "s1", expires_at: "2026-09-04T10:00:00.000Z" });
    await harness.janitor.markRunStarted("s-other");
    expect(harness.storage.values.extension_import_session).toEqual({
      session_id: "s1",
      expires_at: "2026-09-04T10:00:00.000Z",
    });
    await harness.janitor.markRunStarted("s1");
    expect(harness.storage.values.extension_import_session).toEqual({
      session_id: "s1",
      expires_at: "2026-09-04T10:00:00.000Z",
      [RUN_STARTED_AT_KEY]: NOW,
    });
  });
});
