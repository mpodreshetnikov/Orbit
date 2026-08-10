import { describe, expect, it, vi } from "vitest";
import { withUserClient, type ToolContext } from "./tool-context";
import { ok } from "./tool-result";

vi.mock("./supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));

function context(scopes: string[]): ToolContext {
  return {
    http: {
      authInfo: {
        scopes,
        extra: {
          grantId: "grant-1",
          authUserId: "11111111-1111-1111-1111-111111111111",
          userEmail: "u@example.com",
        },
      },
    },
  };
}

describe("withUserClient scope enforcement", () => {
  it("runs a tool that requires no particular scope", async () => {
    const handler = vi.fn().mockResolvedValue(ok("done"));
    const tool = withUserClient(handler);

    const result = await tool({}, context(["health:read"]));

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
  });

  it("runs a write tool when write was granted", async () => {
    const handler = vi.fn().mockResolvedValue(ok("written"));
    const tool = withUserClient(handler, { requiredScope: "health:write" });

    const result = await tool({}, context(["health:read", "health:write"]));

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
  });

  // The consent screen offers read and write separately, so a read-only grant
  // must not be able to write. Without this check the screen would be lying.
  it("refuses a write tool on a read-only grant, without touching the handler", async () => {
    const handler = vi.fn().mockResolvedValue(ok("written"));
    const tool = withUserClient(handler, { requiredScope: "health:write" });

    const result = await tool({}, context(["health:read"]));

    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("health:write"),
    });
  });

  it("refuses a write tool when no scopes are present at all", async () => {
    const handler = vi.fn();
    const tool = withUserClient(handler, { requiredScope: "health:write" });

    const result = await tool({}, { http: { authInfo: { extra: {} } } });

    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("turns a thrown handler error into a tool error rather than letting it escape", async () => {
    // Escaping would reach withMcpAuth and be reported as a 401, sending the
    // client through OAuth again for what is really a query failure.
    const tool = withUserClient(async () => {
      throw new Error("relation does not exist");
    });

    const result = await tool({}, context(["health:read"]));

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: "relation does not exist" });
  });

  it("reports a missing auth context as a tool error", async () => {
    const tool = withUserClient(async () => ok("never"));

    const result = await tool({}, {});

    expect(result.isError).toBe(true);
  });
});
