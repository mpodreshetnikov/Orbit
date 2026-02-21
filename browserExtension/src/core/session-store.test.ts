import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./session-store.js";

describe("session-store", () => {
  it("reads and writes extension session payload", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ extension_import_session: { id: "s1" } }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const store = createSessionStore(storage);

    await expect(store.getSession()).resolves.toEqual({ id: "s1" });
    await store.setSession({ id: "s2" });

    expect(storage.get).toHaveBeenCalledWith(["extension_import_session"]);
    expect(storage.set).toHaveBeenCalledWith({
      extension_import_session: { id: "s2" },
    });
  });
});
