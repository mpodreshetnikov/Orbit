import { describe, expect, it } from "vitest";
import { buildCodexToml } from "./sync-mcp-configs";

describe("sync-mcp-configs", () => {
  it("includes a codex notify command for telegram integration", () => {
    const toml = buildCodexToml(
      {
        servers: {
          github: {
            transport: "http",
            url: "https://example.com/mcp",
          },
        },
      },
      {},
    );

    expect(toml).toContain('notify = ["node",');
    expect(toml).toContain("agent-telegram-notify.mjs");
  });
});
