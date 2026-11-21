import { describe, expect, it, vi, beforeEach } from "vitest";
import { withUserClient, withPerson, type ToolContext } from "./tool-context";
import { ok } from "./tool-result";
import { runWithMcpToolName, logMcpToolCallStarted, logMcpToolCallCompleted } from "./audit";

vi.mock("./supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));

vi.mock("./resolve-person", () => ({
  resolvePerson: vi.fn(),
}));

vi.mock("./audit", async () => {
  const actual = await vi.importActual<typeof import("./audit")>("./audit");
  return {
    ...actual,
    logMcpToolCallStarted: vi.fn(),
    logMcpToolCallCompleted: vi.fn(),
  };
});

import { resolvePerson } from "./resolve-person";

function context(scopes: string[], clientId = "mcp_client_1"): ToolContext {
  return {
    http: {
      authInfo: {
        clientId,
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
  beforeEach(() => {
    vi.mocked(logMcpToolCallStarted).mockClear();
    vi.mocked(logMcpToolCallCompleted).mockClear();
  });

  it("runs a tool that requires no particular scope", async () => {
    const handler = vi.fn().mockResolvedValue(ok("done"));
    const tool = withUserClient(handler);

    const result = await runWithMcpToolName("list_persons", () =>
      tool({}, context(["health:read"])),
    );

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
    expect(logMcpToolCallStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "list_persons",
        grantId: "grant-1",
        clientId: "mcp_client_1",
        argKeys: "",
      }),
    );
    expect(logMcpToolCallCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "list_persons",
        outcome: "ok",
        grantId: "grant-1",
        clientId: "mcp_client_1",
      }),
    );
  });

  it("runs a write tool when write was granted", async () => {
    const handler = vi.fn().mockResolvedValue(ok("written"));
    const tool = withUserClient(handler, { requiredScope: "health:write" });

    const result = await runWithMcpToolName("add_measurement", () =>
      tool({ value: 1 }, context(["health:read", "health:write"])),
    );

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
    expect(logMcpToolCallStarted).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "add_measurement", argKeys: "value" }),
    );
  });

  // The consent screen offers read and write separately, so a read-only grant
  // must not be able to write. Without this check the screen would be lying.
  it("refuses a write tool on a read-only grant, without touching the handler", async () => {
    const handler = vi.fn().mockResolvedValue(ok("written"));
    const tool = withUserClient(handler, { requiredScope: "health:write" });

    const result = await runWithMcpToolName("add_measurement", () =>
      tool({}, context(["health:read"])),
    );

    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("health:write"),
    });
    expect(logMcpToolCallCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "error", tool: "add_measurement" }),
    );
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

    const result = await runWithMcpToolName("list_persons", () =>
      tool({}, context(["health:read"])),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: "relation does not exist" });
    expect(logMcpToolCallCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "error" }),
    );
  });

  it("reports a missing auth context as a tool error", async () => {
    const tool = withUserClient(async () => ok("never"));

    const result = await tool({}, {});

    expect(result.isError).toBe(true);
    expect(logMcpToolCallCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "error", grantId: "missing" }),
    );
  });

  it("logs isError results as outcome error without throwing", async () => {
    const tool = withUserClient(async () => ({
      content: [{ type: "text" as const, text: "nope" }],
      isError: true,
    }));

    const result = await runWithMcpToolName("get_person", () => tool({}, context(["health:read"])));

    expect(result.isError).toBe(true);
    const completed = vi.mocked(logMcpToolCallCompleted).mock.calls[0]?.[0];
    expect(completed?.outcome).toBe("error");
    expect(completed?.tool).toBe("get_person");
  });

  it("never puts argument values into audit attrs", async () => {
    const tool = withUserClient(async () => ok("done"));
    const result = await runWithMcpToolName("search_medical_records", () =>
      tool({ query: "glucose", person_id: "p-1" }, context(["health:read"])),
    );

    expect(result.isError).toBeUndefined();
    const started = vi.mocked(logMcpToolCallStarted).mock.calls[0]?.[0];
    expect(started?.argKeys).toBe("person_id,query");
    expect(JSON.stringify(started)).not.toContain("glucose");
  });
});

describe("withPerson audit person id", () => {
  beforeEach(() => {
    vi.mocked(logMcpToolCallCompleted).mockClear();
    vi.mocked(resolvePerson).mockReset();
  });

  it("records the resolved person id on the completed audit line", async () => {
    vi.mocked(resolvePerson).mockResolvedValue({
      status: "ok",
      person: { id: "person-resolved", name: "Fixture", kind: "human" },
    });

    const tool = withPerson(async () => ok("done"));
    const result = await runWithMcpToolName("get_person", () =>
      tool({ person_name: "Fixture" }, context(["health:read"])),
    );

    expect(result.isError).toBeUndefined();
    const completed = vi.mocked(logMcpToolCallCompleted).mock.calls[0]?.[0];
    expect(completed?.tool).toBe("get_person");
    expect(completed?.personId).toBe("person-resolved");
    expect(completed?.outcome).toBe("ok");
    // Name must not appear in audit payload.
    expect(JSON.stringify(completed)).not.toContain("Fixture");
  });

  it("leaves person id unset when resolution fails", async () => {
    vi.mocked(resolvePerson).mockResolvedValue({
      status: "ambiguous",
      message: "which one?",
      candidates: [],
    });

    const tool = withPerson(async () => ok("never"));
    const result = await runWithMcpToolName("get_person", () =>
      tool({ person_name: "x" }, context(["health:read"])),
    );

    expect(result.isError).toBe(true);
    const completed = vi.mocked(logMcpToolCallCompleted).mock.calls[0]?.[0];
    expect(completed?.outcome).toBe("error");
    expect(completed?.personId).toBeNull();
  });
});
