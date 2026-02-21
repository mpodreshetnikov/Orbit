import { beforeEach, describe, expect, it, vi } from "vitest";

describe("connector-types registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers connectors uniquely by sourceId", async () => {
    const registry = await import("./connector-types");
    const connector = {
      sourceId: "sample",
      displayName: "Sample",
      kind: "extension" as const,
    };

    registry.registerConnector(connector);
    registry.registerConnector(connector);

    expect(registry.getConnectors()).toEqual([connector]);
  });

  it("gets connector by source id", async () => {
    const registry = await import("./connector-types");
    const connector = {
      sourceId: "csv",
      displayName: "CSV",
      kind: "file" as const,
      fileAccept: {
        "text/csv": [".csv"],
      },
      parse: async () => ({ transactions: [] }),
    };

    registry.registerConnector(connector);
    expect(registry.getConnector("csv")).toEqual(connector);
    expect(registry.getConnector("missing")).toBeUndefined();
  });
});
