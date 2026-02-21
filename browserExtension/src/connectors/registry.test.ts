import { beforeEach, describe, expect, it, vi } from "vitest";

describe("extension connector registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers and retrieves connectors", async () => {
    const registry = await import("./registry.js");
    const connector = {
      sourceId: "demo",
      displayName: "Demo",
      parse: async () => ({
        rows: [],
        windowTo: "2026-01-01T00:00:00.000Z",
        parsedThroughAt: "2026-01-01T00:00:00.000Z",
        parsedTransactionsCount: 0,
      }),
    };

    registry.registerConnector(connector);
    registry.registerConnector(connector);

    expect(registry.getConnector("demo")).toBe(connector);
    expect(registry.getConnectors()).toHaveLength(1);
  });
});
