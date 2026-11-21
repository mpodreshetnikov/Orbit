import { describe, expect, it, vi } from "vitest";
import {
  hashMcpUserId,
  installMcpToolNamePropagation,
  mcpArgumentShape,
  noteMcpPersonFromRow,
  noteMcpPersonIdFromArgs,
  noteMcpResolvedPersonId,
  currentMcpPersonId,
  currentMcpToolName,
  currentMcpToolRequestId,
  runWithMcpToolAuditScope,
  runWithMcpToolName,
  logMcpAuthAccepted,
  logMcpAuthRejected,
  logMcpToolCallCompleted,
  logMcpToolCallStarted,
} from "./audit";
import type { McpToolServer } from "./tools/types";
import { buildTelemetryEvent } from "@shared/lib/observability/logger";
import { validateTelemetryLogEvent } from "@shared/lib/observability/schema";

const { infoMock, warnMock, createServerLoggerMock, generateRequestIdMock } = vi.hoisted(() => {
  const infoMock = vi.fn();
  const warnMock = vi.fn();
  return {
    infoMock,
    warnMock,
    generateRequestIdMock: vi.fn(() => "req-shared-1"),
    createServerLoggerMock: vi.fn(
      (_options?: { component?: string; userIdHash?: string; requestId?: string }) => ({
        info: infoMock,
        warn: warnMock,
        debug: vi.fn(),
        error: vi.fn(),
        requestId: _options?.requestId ?? "req-test",
      }),
    ),
  };
});

vi.mock("@/lib/observability/server-logger", () => ({
  createServerLogger: createServerLoggerMock,
}));

vi.mock("@shared/lib/observability/correlation", async () => {
  const actual = await vi.importActual<typeof import("@shared/lib/observability/correlation")>(
    "@shared/lib/observability/correlation",
  );
  return {
    ...actual,
    generateRequestId: generateRequestIdMock,
  };
});

describe("mcpArgumentShape", () => {
  it("returns sorted keys and never values", () => {
    expect(mcpArgumentShape({ limit: 5, person_id: "secret-uuid", name: "Alice" })).toBe(
      "limit,name,person_id",
    );
  });

  it("returns empty for non-objects", () => {
    expect(mcpArgumentShape(null)).toBe("");
    expect(mcpArgumentShape("x")).toBe("");
    expect(mcpArgumentShape([1, 2])).toBe("");
  });
});

describe("hashMcpUserId", () => {
  it("returns a stable 16-char hex digest", () => {
    const a = hashMcpUserId("11111111-1111-1111-1111-111111111111");
    const b = hashMcpUserId("11111111-1111-1111-1111-111111111111");
    expect(a).toMatch(/^[a-f0-9]{16}$/);
    expect(a).toBe(b);
    expect(a).not.toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("tool name and person audit scope", () => {
  it("exposes the registered tool name inside runWithMcpToolName", () => {
    expect(currentMcpToolName()).toBe("unknown");
    runWithMcpToolName("list_persons", () => {
      expect(currentMcpToolName()).toBe("list_persons");
    });
  });

  it("keeps resolved person id on the mutable audit scope until the run ends", async () => {
    await runWithMcpToolAuditScope(async () => {
      expect(currentMcpPersonId()).toBeUndefined();
      noteMcpResolvedPersonId("person-1");
      expect(currentMcpPersonId()).toBe("person-1");
      await Promise.resolve();
      expect(currentMcpPersonId()).toBe("person-1");
    });
    expect(currentMcpPersonId()).toBeUndefined();
  });

  it("notes person id from args.person_id and from a loaded row", async () => {
    await runWithMcpToolAuditScope(async () => {
      noteMcpPersonIdFromArgs({ person_id: "person-from-args", query: "x" });
      expect(currentMcpPersonId()).toBe("person-from-args");
      noteMcpPersonFromRow({ person_id: "person-from-row" });
      expect(currentMcpPersonId()).toBe("person-from-row");
      noteMcpPersonIdFromArgs({ query: "no-person" });
      expect(currentMcpPersonId()).toBe("person-from-row");
      noteMcpPersonFromRow(null);
      expect(currentMcpPersonId()).toBe("person-from-row");
    });
  });

  it("assigns one request id for the audit scope", async () => {
    generateRequestIdMock.mockClear();
    generateRequestIdMock.mockReturnValueOnce("req-invocation-a");
    await runWithMcpToolAuditScope(async () => {
      expect(currentMcpToolRequestId()).toBe("req-invocation-a");
      expect(generateRequestIdMock).toHaveBeenCalledTimes(1);
    });
    expect(currentMcpToolRequestId()).toBeUndefined();
  });

  it("ignores noteMcpResolvedPersonId outside an audit scope", () => {
    expect(() => noteMcpResolvedPersonId("person-outside")).not.toThrow();
    expect(currentMcpPersonId()).toBeUndefined();
  });

  it("installMcpToolNamePropagation runs handlers under the tool name", () => {
    const originalRegister = vi.fn(
      (_name: string, _config: unknown, handler: (args: unknown, extra: unknown) => unknown) => {
        void handler;
      },
    );
    const server = {
      registerTool: originalRegister as unknown as McpToolServer["registerTool"],
    };
    installMcpToolNamePropagation(server);

    let seen = "unset";
    (server.registerTool as unknown as (...args: unknown[]) => unknown)("get_person", {}, () => {
      seen = currentMcpToolName();
      return { ok: true };
    });

    const wrappedHandler = originalRegister.mock.calls[0]?.[2] as (
      args: unknown,
      extra: unknown,
    ) => { ok: boolean };
    const result = wrappedHandler({}, {});
    expect(result).toEqual({ ok: true });
    expect(seen).toBe("get_person");
  });
});

describe("audit log emitters", () => {
  it("emits tool start and completion with scalar attrs only", () => {
    infoMock.mockClear();
    createServerLoggerMock.mockClear();

    logMcpToolCallStarted({
      tool: "list_persons",
      grantId: "grant-1",
      clientId: "mcp_abc",
      userIdHash: "abcd1234efgh5678",
      argKeys: "kind",
      personId: null,
    });
    logMcpToolCallCompleted({
      tool: "list_persons",
      outcome: "ok",
      durationMs: 12.6,
      grantId: "grant-1",
      clientId: "mcp_abc",
      userIdHash: "abcd1234efgh5678",
      argKeys: "kind",
      personId: null,
    });

    const loggerOpts = createServerLoggerMock.mock.calls[0]?.[0] as unknown as {
      component: string;
      userIdHash: string;
    };
    expect(loggerOpts).toEqual({ component: "mcp-tool", userIdHash: "abcd1234efgh5678" });

    const started = infoMock.mock.calls.find((c) => c[0] === "mcp_tool_call_started")?.[1] as
      | Record<string, unknown>
      | undefined;
    const completed = infoMock.mock.calls.find((c) => c[0] === "mcp_tool_call_completed")?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(started).toEqual({
      tool: "list_persons",
      grant_id: "grant-1",
      client_id: "mcp_abc",
      arg_keys: "kind",
      person_id: null,
    });
    expect(completed).toEqual({
      tool: "list_persons",
      outcome: "ok",
      duration_ms: 13,
      grant_id: "grant-1",
      client_id: "mcp_abc",
      arg_keys: "kind",
      person_id: null,
    });

    infoMock.mockClear();
    logMcpToolCallCompleted({
      tool: "get_person",
      outcome: "ok",
      durationMs: 2,
      grantId: "grant-1",
      clientId: "mcp_abc",
      userIdHash: "abcd1234efgh5678",
      argKeys: "person_id",
      personId: "person-resolved",
    });
    const withPerson = infoMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(withPerson.person_id).toBe("person-resolved");
  });

  it("reuses one requestId for start and completed inside an audit scope", async () => {
    generateRequestIdMock.mockReturnValueOnce("req-pair-99");
    infoMock.mockClear();
    createServerLoggerMock.mockClear();

    await runWithMcpToolAuditScope(async () => {
      logMcpToolCallStarted({
        tool: "activate_medical_record",
        grantId: "grant-1",
        clientId: "mcp_abc",
        userIdHash: "abcd1234efgh5678",
        argKeys: "record_id",
        personId: null,
      });
      logMcpToolCallCompleted({
        tool: "activate_medical_record",
        outcome: "ok",
        durationMs: 5,
        grantId: "grant-1",
        clientId: "mcp_abc",
        userIdHash: "abcd1234efgh5678",
        argKeys: "record_id",
        personId: "person-owned",
      });
    });

    const opts = createServerLoggerMock.mock.calls.map(
      (call) => call[0] as { component: string; requestId?: string; userIdHash?: string },
    );
    expect(opts).toHaveLength(2);
    expect(opts[0]?.requestId).toBe("req-pair-99");
    expect(opts[1]?.requestId).toBe("req-pair-99");
    expect(opts[0]?.requestId).toBe(opts[1]?.requestId);
  });

  it("emits auth accept and reject without raw tokens", () => {
    infoMock.mockClear();
    warnMock.mockClear();

    logMcpAuthAccepted({
      grantId: "grant-1",
      clientId: "mcp_abc",
      userIdHash: "abcd1234efgh5678",
      durationMs: 4,
    });
    logMcpAuthRejected({
      reason: "revoked",
      durationMs: 3,
      grantId: "grant-1",
      clientId: "mcp_abc",
      userIdHash: "abcd1234efgh5678",
      tokenHashPrefix: "deadbeef",
    });

    const accepted = infoMock.mock.calls[0]?.[1] as Record<string, unknown>;
    const rejected = warnMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(infoMock.mock.calls[0]?.[0]).toBe("mcp_auth_accepted");
    expect(accepted).toEqual({
      grant_id: "grant-1",
      client_id: "mcp_abc",
      outcome: "accepted",
      duration_ms: 4,
    });
    expect(warnMock.mock.calls[0]?.[0]).toBe("mcp_auth_rejected");
    expect(rejected).toEqual({
      outcome: "rejected",
      reason: "revoked",
      duration_ms: 3,
      grant_id: "grant-1",
      client_id: "mcp_abc",
      token_hash_prefix: "deadbeef",
    });
    expect(JSON.stringify(rejected)).not.toMatch(/Bearer|eyJ/);
  });

  it("tool and auth attr payloads validate against the shared log schema", () => {
    const toolEvent = buildTelemetryEvent(
      {
        app: "api",
        component: "mcp-tool",
        env: "local",
        release: "test",
        user_id_hash: "abcd1234efgh5678",
      },
      {
        level: "info",
        message: "mcp_tool_call_completed",
        attrs: {
          tool: "list_persons",
          outcome: "ok",
          duration_ms: 13,
          grant_id: "grant-1",
          client_id: "mcp_abc",
          arg_keys: "kind",
          person_id: null,
        },
        correlation: {
          request_id: "req-1",
          trace_id: "a".repeat(32),
          span_id: "b".repeat(16),
        },
      },
    );
    const authEvent = buildTelemetryEvent(
      {
        app: "api",
        component: "mcp-auth",
        env: "local",
        release: "test",
        user_id_hash: "abcd1234efgh5678",
      },
      {
        level: "warn",
        message: "mcp_auth_rejected",
        attrs: {
          outcome: "rejected",
          reason: "revoked",
          duration_ms: 3,
          grant_id: "grant-1",
          client_id: "mcp_abc",
          token_hash_prefix: "deadbeef",
        },
        correlation: {
          request_id: "req-2",
          trace_id: "c".repeat(32),
          span_id: "d".repeat(16),
        },
      },
    );

    expect(validateTelemetryLogEvent(toolEvent)).toEqual({ ok: true, value: toolEvent });
    expect(validateTelemetryLogEvent(authEvent)).toEqual({ ok: true, value: authEvent });
  });
});
