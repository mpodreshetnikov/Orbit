import { describe, expect, it, vi } from "vitest";
import { runCli } from "./agent-telegram-notify.mjs";

const enabledEnv = [
  "AGENT_TELEGRAM_NOTIFICATIONS_ENABLED=1",
  "AGENT_TELEGRAM_BOT_TOKEN=test-token",
  "AGENT_TELEGRAM_CHAT_ID=test-chat",
].join("\n");

describe("agent-telegram-notify", () => {
  it("does nothing when notifications are disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const exitCode = await runCli(["codex", "agent-turn-complete", "Done", "Finished"], {
      readEnvFile: async () =>
        [
          "AGENT_TELEGRAM_NOTIFICATIONS_ENABLED=0",
          "AGENT_TELEGRAM_BOT_TOKEN=test-token",
          "AGENT_TELEGRAM_CHAT_ID=test-chat",
        ].join("\n"),
      processEnv: {},
      fetchImpl,
      readStdin: async () => "",
      logError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores codex events other than agent-turn-complete", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const exitCode = await runCli(["codex", "session-start", "Start", "Started"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () => "",
      logError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends codex completion events to telegram", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const exitCode = await runCli(
      ["codex", "agent-turn-complete", "Task done", "Implementation finished"],
      {
        readEnvFile: async () => enabledEnv,
        processEnv: {},
        fetchImpl,
        readStdin: async () => "",
        logError: vi.fn(),
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: expect.stringContaining('"chat_id":"test-chat"'),
      }),
    );
    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();
    const body = JSON.parse(String(secondArg?.body)) as { text: string };
    expect(body.text).toBe("[Codex] Implementation finished");
  });

  it("sends only last agent response for official codex notify payloads", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const exitCode = await runCli(
      [
        JSON.stringify({
          type: "agent-turn-complete",
          "last-assistant-message": "Final answer from agent",
          "input-messages": [
            "You are Codex, a coding agent.",
            "Please fix telegram notifications for this script.",
          ],
        }),
      ],
      {
        readEnvFile: async () => enabledEnv,
        processEnv: {},
        fetchImpl,
        readStdin: async () => "",
        logError: vi.fn(),
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();
    const body = JSON.parse(String(secondArg?.body)) as { text: string };
    expect(body.text).toBe("[Codex] Final answer from agent");
  });

  it("handles codex notify payloads passed via stdin", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const exitCode = await runCli([], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () =>
        JSON.stringify({
          type: "agent-turn-complete",
          "last-assistant-message": "Final response from stdin",
          "input-messages": ["stdin", "input"],
        }),
      logError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();
    const body = JSON.parse(String(secondArg?.body)) as { text: string };
    expect(body.text).toBe("[Codex] Final response from stdin");
  });

  it("ignores codex title-generation payloads", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const exitCode = await runCli(
      [
        JSON.stringify({
          type: "agent-turn-complete",
          "last-assistant-message": '{"title":"Fix Telegram alerts for Codex agent"}',
          "input-messages": [
            "You are a helpful assistant.",
            "You will be presented with a user prompt, and your job is to provide a short title for a task.",
            "Generate a concise UI title (18-36 characters) for this task.",
            "Return only the title.",
          ],
        }),
      ],
      {
        readEnvFile: async () => enabledEnv,
        processEnv: {},
        fetchImpl,
        readStdin: async () => "",
        logError: vi.fn(),
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends cursor stop payload to telegram", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const exitCode = await runCli(["cursor", "stop"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () =>
        JSON.stringify({
          status: "completed",
          loop_count: 3,
          assistant_message: "summary from cursor",
        }),
      logError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();

    const body = JSON.parse(String(secondArg?.body)) as {
      chat_id: string;
      text: string;
    };
    expect(body.chat_id).toBe("test-chat");
    expect(body.text).toContain("completed");
    expect(body.text).toContain("3");
    expect(body.text).toContain("Last response:");
    expect(body.text).toContain("summary from cursor");
    expect(body.text).not.toContain("Conversation:");
  });

  it("parses cursor payload nested under top-level payload key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const exitCode = await runCli(["cursor", "stop"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () =>
        JSON.stringify({
          payload: {
            status: "completed",
            loop_count: 5,
            assistant_message: "nested final message",
          },
        }),
      logError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();
    const body = JSON.parse(String(secondArg?.body)) as { text: string };
    expect(body.text).toContain("completed");
    expect(body.text).toContain("5");
    expect(body.text).toContain("nested final message");
  });

  it("falls back to cursor payload passed as an argument", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const exitCode = await runCli(
      [
        "cursor",
        "stop",
        JSON.stringify({
          status: "completed",
          loop_count: 2,
          assistant_message: "arg final response",
        }),
      ],
      {
        readEnvFile: async () => enabledEnv,
        processEnv: {},
        fetchImpl,
        readStdin: async () => "",
        logError: vi.fn(),
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();
    const body = JSON.parse(String(secondArg?.body)) as { text: string };
    expect(body.text).toContain("completed");
    expect(body.text).toContain("2");
    expect(body.text).toContain("arg final response");
  });

  it("uses cached afterAgentResponse text when stop payload has no response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });
    const state = new Map<string, string>();

    const readCursorState = async (workspaceId: string) => state.get(workspaceId);
    const writeCursorState = async (workspaceId: string, responseText: string) => {
      state.set(workspaceId, responseText);
    };

    const afterResponseExitCode = await runCli(["cursor", "afterAgentResponse"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () =>
        JSON.stringify({
          workspace_root: "test-workspace",
          assistant_message: "cached assistant answer",
        }),
      readCursorState,
      writeCursorState,
      logError: vi.fn(),
    });

    expect(afterResponseExitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    const stopExitCode = await runCli(["cursor", "stop"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () =>
        JSON.stringify({
          workspace_root: "test-workspace",
          status: "completed",
          loop_count: 0,
        }),
      readCursorState,
      writeCursorState,
      logError: vi.fn(),
    });

    expect(stopExitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();
    const body = JSON.parse(String(secondArg?.body)) as { text: string };
    expect(body.text).toContain("cached assistant answer");
  });

  it("uses explicit payload-missing detail when cursor stop input is empty", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const exitCode = await runCli(["cursor", "stop"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () => "",
      logError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const secondArg = fetchImpl.mock.calls[0]?.[1];
    expect(secondArg).toBeDefined();
    const body = JSON.parse(String(secondArg?.body)) as { text: string };
    expect(body.text).toContain("Details: hook payload not provided by Cursor");
    expect(body.text).not.toContain("Status: unknown");
  });

  it("fails open when telegram responds with failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: false, description: "boom" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });
    const logError = vi.fn();

    const exitCode = await runCli(["codex", "agent-turn-complete", "Done", "Finished"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () => "",
      logError,
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalled();
  });

  it("fails open when telegram returns non-200 HTTP status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response("internal error", {
        status: 500,
        headers: {
          "content-type": "text/plain",
        },
      });
    });
    const logError = vi.fn();

    const exitCode = await runCli(["codex", "agent-turn-complete", "Done", "Finished"], {
      readEnvFile: async () => enabledEnv,
      processEnv: {},
      fetchImpl,
      readStdin: async () => "",
      logError,
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalled();
  });
});
