import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_TEXT_LIMIT = 4096;
const CURSOR_SUMMARY_LIMIT = 240;

/**
 * @typedef {{
 *   readEnvFile: () => Promise<string | undefined>;
 *   processEnv: Record<string, string | undefined>;
 *   fetchImpl: typeof fetch;
 *   readStdin: () => Promise<string>;
 *   readCursorState: (workspaceId: string) => Promise<string | undefined>;
 *   writeCursorState: (workspaceId: string, responseText: string) => Promise<void>;
 *   logError: (message: string) => void;
 * }} RuntimeDependencies
 */

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isEnabled(value) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function readValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncateTelegramText(text) {
  const characters = Array.from(text);
  if (characters.length <= TELEGRAM_TEXT_LIMIT) {
    return text;
  }

  return `${characters.slice(0, TELEGRAM_TEXT_LIMIT - 3).join("")}...`;
}

/**
 * @param {unknown} value
 * @param {number} [limit]
 * @returns {string | undefined}
 */
function compactSummary(value, limit = CURSOR_SUMMARY_LIMIT) {
  if (typeof value !== "string") {
    return undefined;
  }

  const compacted = value.trim().replace(/\s+/gu, " ");
  if (!compacted) {
    return undefined;
  }

  const characters = Array.from(compacted);
  if (characters.length <= limit) {
    return compacted;
  }

  return `${characters.slice(0, Math.max(0, limit - 3)).join("")}...`;
}

/**
 * @returns {Promise<string | undefined>}
 */
async function defaultReadEnvFile() {
  const candidatePaths = [
    path.join(process.cwd(), "mcp", ".env"),
    path.resolve(scriptDir, "..", "mcp", ".env"),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return await fs.readFile(candidatePath, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        /** @type {{code?: string}} */ (error).code === "ENOENT"
      ) {
        continue;
      }

      throw error;
    }
  }

  return undefined;
}

/**
 * @param {string} workspaceId
 * @returns {string}
 */
function cursorStateFilePath(workspaceId) {
  const hash = crypto.createHash("sha256").update(workspaceId).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `agent-telegram-cursor-${hash}.json`);
}

/**
 * @param {string} workspaceId
 * @returns {Promise<string | undefined>}
 */
async function defaultReadCursorState(workspaceId) {
  const filePath = cursorStateFilePath(workspaceId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return readValue(String(parsed.lastResponse ?? ""));
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      /** @type {{code?: string}} */ (error).code === "ENOENT"
    ) {
      return undefined;
    }
  }

  return undefined;
}

/**
 * @param {string} workspaceId
 * @param {string} responseText
 * @returns {Promise<void>}
 */
async function defaultWriteCursorState(workspaceId, responseText) {
  const filePath = cursorStateFilePath(workspaceId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        lastResponse: responseText,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * @param {Partial<RuntimeDependencies>} [overrides]
 * @returns {RuntimeDependencies}
 */
function buildDeps(overrides = {}) {
  return {
    readEnvFile: overrides.readEnvFile ?? defaultReadEnvFile,
    processEnv: overrides.processEnv ?? process.env,
    fetchImpl: overrides.fetchImpl ?? fetch,
    readStdin:
      overrides.readStdin ??
      (async () => {
        let stdinText = "";
        process.stdin.setEncoding("utf8");
        for await (const chunk of process.stdin) {
          stdinText += chunk;
        }
        return stdinText;
      }),
    readCursorState: overrides.readCursorState ?? defaultReadCursorState,
    writeCursorState: overrides.writeCursorState ?? defaultWriteCursorState,
    logError: overrides.logError ?? ((message) => console.error(message)),
  };
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function extractTextCandidate(value) {
  if (typeof value === "string") {
    return readValue(value);
  }

  if (Array.isArray(value)) {
    const parts = value.map((part) => extractTextCandidate(part)).filter(Boolean);
    return readValue(parts.join(" "));
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = /** @type {Record<string, unknown>} */ (value);
  return (
    extractTextCandidate(record.text) ??
    extractTextCandidate(record.message) ??
    extractTextCandidate(record.response) ??
    extractTextCandidate(record.output) ??
    extractTextCandidate(record.value) ??
    extractTextCandidate(record.content) ??
    extractTextCandidate(record.final_message) ??
    extractTextCandidate(record.finalMessage) ??
    extractTextCandidate(record.parts)
  );
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function resolveCursorWorkspaceId(payload) {
  const workspaceRoots = Array.isArray(payload.workspace_roots)
    ? payload.workspace_roots.filter((value) => typeof value === "string")
    : [];
  const explicitWorkspace =
    extractTextCandidate(payload.workspace_root) ??
    extractTextCandidate(payload.workspaceRoot) ??
    extractTextCandidate(payload.project_path) ??
    extractTextCandidate(payload.projectPath) ??
    extractTextCandidate(workspaceRoots[0]);

  return explicitWorkspace ?? process.cwd();
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string | undefined}
 */
function extractCursorLastResponse(payload) {
  const directCandidate =
    extractTextCandidate(payload.last_assistant_message) ??
    extractTextCandidate(payload.lastAssistantMessage) ??
    extractTextCandidate(payload.assistant_message) ??
    extractTextCandidate(payload.assistantMessage) ??
    extractTextCandidate(payload.agent_message) ??
    extractTextCandidate(payload.agentMessage) ??
    extractTextCandidate(payload.response) ??
    extractTextCandidate(payload.final_message) ??
    extractTextCandidate(payload.finalMessage);
  if (directCandidate) {
    return compactSummary(directCandidate);
  }

  const containerCandidate =
    extractTextCandidate(payload.data) ??
    extractTextCandidate(payload.result) ??
    extractTextCandidate(payload.output);
  if (containerCandidate) {
    return compactSummary(containerCandidate);
  }

  const messageCollections = [
    payload.messages,
    payload.chat_history,
    payload.history,
    payload.transcript,
    payload.events,
    payload.turns,
  ];
  for (const collection of messageCollections) {
    if (!Array.isArray(collection)) {
      continue;
    }

    for (let index = collection.length - 1; index >= 0; index -= 1) {
      const item = collection[index];
      if (!item || typeof item !== "object") {
        continue;
      }

      const message = /** @type {Record<string, unknown>} */ (item);
      const role = readValue(
        String(message.role ?? message.author ?? message.speaker ?? message.type ?? ""),
      )?.toLowerCase();
      if (role && !["assistant", "agent", "model"].includes(role)) {
        continue;
      }

      const extracted =
        extractTextCandidate(message.content) ??
        extractTextCandidate(message.text) ??
        extractTextCandidate(message.message) ??
        extractTextCandidate(message.response) ??
        extractTextCandidate(message.output);
      if (extracted) {
        return compactSummary(extracted);
      }
    }
  }

  const fallbackCandidate =
    extractTextCandidate(payload.summary) ?? extractTextCandidate(payload.text);
  if (fallbackCandidate) {
    return compactSummary(fallbackCandidate);
  }

  return undefined;
}

/**
 * @param {RuntimeDependencies} deps
 * @returns {Promise<Record<string, string>>}
 */
async function loadMergedEnv(deps) {
  const envFromFile = {};
  const envFileText = await deps.readEnvFile();
  if (envFileText) {
    const parsed = parseEnv(envFileText);
    for (const [key, value] of Object.entries(parsed)) {
      envFromFile[key] = String(value);
    }
  }

  /** @type {Record<string, string>} */
  const merged = { ...envFromFile };
  for (const [key, value] of Object.entries(deps.processEnv)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string | undefined} lastResponse
 * @returns {string}
 */
function buildCursorStopMessage(payload, lastResponse) {
  const status =
    readValue(String(payload.status ?? payload.final_status ?? payload.reason ?? "")) ?? "unknown";
  const loopCount = Number.isFinite(payload.loop_count)
    ? String(payload.loop_count)
    : (readValue(String(payload.loop_count ?? "")) ?? "unknown");

  const hasCoreDetails = status !== "unknown" || loopCount !== "unknown" || Boolean(lastResponse);
  if (!hasCoreDetails) {
    return [
      "[Cursor] Agent step finished",
      "Details: hook payload not provided by Cursor (no stop-event JSON received).",
    ].join("\n");
  }

  const lines = [
    "[Cursor] Agent step finished",
    `Status: ${status}`,
    `Loop count: ${loopCount}`,
    `Last response: ${lastResponse ?? "(unavailable)"}`,
  ];

  return lines.join("\n");
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isCodexTitleObject(value) {
  const candidate = readValue(value);
  if (!candidate) {
    return false;
  }

  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }

    const record = /** @type {Record<string, unknown>} */ (parsed);
    return Object.keys(record).length === 1 && typeof record.title === "string";
  } catch {
    return false;
  }
}

/**
 * @param {string} response
 * @returns {string}
 */
function buildCodexTaggedResponse(response) {
  return `[Codex] ${response}`;
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string | undefined}
 */
function extractCodexLastResponse(payload) {
  const directCandidate =
    extractTextCandidate(payload["last-assistant-message"]) ??
    extractTextCandidate(payload.last_assistant_message) ??
    extractTextCandidate(payload.lastAssistantMessage) ??
    extractTextCandidate(payload.assistant_message) ??
    extractTextCandidate(payload.assistantMessage) ??
    extractTextCandidate(payload.final_message) ??
    extractTextCandidate(payload.finalMessage) ??
    extractTextCandidate(payload.response) ??
    extractTextCandidate(payload.result);
  if (directCandidate) {
    return directCandidate;
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (!item || typeof item !== "object") {
      continue;
    }

    const message = /** @type {Record<string, unknown>} */ (item);
    const role = readValue(
      String(message.role ?? message.author ?? message.speaker ?? message.type ?? ""),
    )?.toLowerCase();
    if (role && !["assistant", "agent", "model"].includes(role)) {
      continue;
    }

    const extracted =
      extractTextCandidate(message.content) ??
      extractTextCandidate(message.text) ??
      extractTextCandidate(message.message) ??
      extractTextCandidate(message.response) ??
      extractTextCandidate(message.output);
    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string | undefined} lastResponse
 * @returns {boolean}
 */
function isLikelyCodexTitleGenerationPayload(payload, lastResponse) {
  const responseLooksLikeTitle =
    isCodexTitleObject(lastResponse) ||
    (Boolean(lastResponse) &&
      !String(lastResponse).includes("\n") &&
      Array.from(String(lastResponse)).length <= 120);
  if (!responseLooksLikeTitle) {
    return false;
  }

  const inputMessages =
    extractTextCandidate(payload["input-messages"]) ??
    extractTextCandidate(payload.input_messages) ??
    extractTextCandidate(payload.inputMessages);
  if (!inputMessages) {
    return false;
  }

  const normalized = inputMessages.toLowerCase();
  return (
    normalized.includes("provide a short title for a task") ||
    normalized.includes("generate a concise ui title") ||
    normalized.includes("return only the title")
  );
}

/**
 * @param {string} rawJson
 * @returns {Record<string, unknown>}
 */
function parsePayload(rawJson) {
  const sanitized = rawJson
    .replace(/^\uFEFF/u, "")
    .replace(/\u0000/gu, "")
    .trim();
  if (!sanitized) {
    return {};
  }

  /**
   * @param {string} candidate
   * @returns {Record<string, unknown> | undefined}
   */
  function parseObject(candidate) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (
          "payload" in parsed &&
          parsed.payload &&
          typeof parsed.payload === "object" &&
          !Array.isArray(parsed.payload)
        ) {
          return /** @type {Record<string, unknown>} */ (parsed.payload);
        }

        return /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  const direct = parseObject(sanitized);
  if (direct) {
    return direct;
  }

  const lines = sanitized.split(/\r?\n/u).map((line) => line.trim());
  for (const line of lines) {
    const parsedLine = parseObject(line);
    if (parsedLine) {
      return parsedLine;
    }
  }

  const firstBrace = sanitized.indexOf("{");
  const lastBrace = sanitized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = sanitized.slice(firstBrace, lastBrace + 1);
    const parsedExtracted = parseObject(extracted);
    if (parsedExtracted) {
      return parsedExtracted;
    }
  }

  return {};
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/u, "");
}

/**
 * @param {{
 *   botToken: string;
 *   chatId: string;
 *   message: string;
 *   baseUrl: string;
 * }} input
 * @param {RuntimeDependencies} deps
 * @returns {Promise<void>}
 */
async function sendTelegramMessage(input, deps) {
  const url = `${normalizeBaseUrl(input.baseUrl)}/bot${input.botToken}/sendMessage`;
  const text = truncateTelegramText(input.message);
  const body = JSON.stringify({
    chat_id: input.chatId,
    text,
  });

  let response;
  try {
    response = await deps.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body,
    });
  } catch (error) {
    deps.logError(
      `[agent-telegram-notify] network error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    deps.logError(
      `[agent-telegram-notify] telegram HTTP ${response.status}: ${responseText || "(empty body)"}`,
    );
    return;
  }

  try {
    const payload = /** @type {{ok?: boolean, description?: string}} */ (await response.json());
    if (payload && payload.ok === false) {
      deps.logError(
        `[agent-telegram-notify] telegram API error: ${payload.description ?? "unknown error"}`,
      );
    }
  } catch (error) {
    deps.logError(
      `[agent-telegram-notify] invalid telegram response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * @param {string[]} args
 * @param {Partial<RuntimeDependencies>} [overrides]
 * @returns {Promise<number>}
 */
export async function runCli(args, overrides = {}) {
  const deps = buildDeps(overrides);

  try {
    const env = await loadMergedEnv(deps);
    if (!isEnabled(readValue(env.AGENT_TELEGRAM_NOTIFICATIONS_ENABLED))) {
      return 0;
    }

    const botToken = readValue(env.AGENT_TELEGRAM_BOT_TOKEN);
    const chatId = readValue(env.AGENT_TELEGRAM_CHAT_ID);
    if (!botToken || !chatId) {
      return 0;
    }

    const baseUrl = readValue(env.AGENT_TELEGRAM_API_BASE_URL) ?? DEFAULT_TELEGRAM_API_BASE_URL;

    const mode = args[0];
    if (mode === "codex") {
      const eventType = args[1] ?? "";
      if (eventType !== "agent-turn-complete") {
        return 0;
      }

      const message = readValue(args[3]) ?? readValue(args[2]);
      if (!message) {
        return 0;
      }

      await sendTelegramMessage(
        {
          botToken,
          chatId,
          message: buildCodexTaggedResponse(message),
          baseUrl,
        },
        deps,
      );
      return 0;
    }

    if (mode === "cursor") {
      const eventType = args[1] ?? "";
      const stdinText = await deps.readStdin();
      const fallbackArgPayload = args.slice(2).join(" ");
      const rawPayload = readValue(stdinText) ?? readValue(fallbackArgPayload) ?? "";
      const payload = parsePayload(rawPayload);
      const workspaceId = resolveCursorWorkspaceId(payload);
      const lastResponseFromPayload = extractCursorLastResponse(payload);

      if (eventType === "afterAgentResponse") {
        if (lastResponseFromPayload) {
          await deps.writeCursorState(workspaceId, lastResponseFromPayload);
        }

        return 0;
      }

      if (eventType !== "stop") {
        return 0;
      }

      const lastResponseFromState =
        lastResponseFromPayload ?? (await deps.readCursorState(workspaceId));
      const message = buildCursorStopMessage(payload, lastResponseFromState);

      await sendTelegramMessage(
        {
          botToken,
          chatId,
          message,
          baseUrl,
        },
        deps,
      );
      return 0;
    }

    // Official Codex notify format: one JSON payload argument (some builds pass via stdin).
    if (args.length > 0) {
      const codexPayload = parsePayload(args[0] ?? "");
      const eventType = readValue(String(codexPayload.type ?? codexPayload.event_type ?? ""));
      if (eventType === "agent-turn-complete") {
        const lastResponse = extractCodexLastResponse(codexPayload);
        if (!isLikelyCodexTitleGenerationPayload(codexPayload, lastResponse) && lastResponse) {
          await sendTelegramMessage(
            {
              botToken,
              chatId,
              message: buildCodexTaggedResponse(lastResponse),
              baseUrl,
            },
            deps,
          );
        }
      }

      return 0;
    }

    const codexStdin = await deps.readStdin();
    if (readValue(codexStdin)) {
      const codexPayload = parsePayload(codexStdin);
      const eventType = readValue(String(codexPayload.type ?? codexPayload.event_type ?? ""));
      if (eventType === "agent-turn-complete") {
        const lastResponse = extractCodexLastResponse(codexPayload);
        if (!isLikelyCodexTitleGenerationPayload(codexPayload, lastResponse) && lastResponse) {
          await sendTelegramMessage(
            {
              botToken,
              chatId,
              message: buildCodexTaggedResponse(lastResponse),
              baseUrl,
            },
            deps,
          );
        }
      }

      return 0;
    }

    return 0;
  } catch (error) {
    deps.logError(
      `[agent-telegram-notify] unexpected error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 0;
  }
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  return path.resolve(process.argv[1]) === scriptPath;
}

if (isDirectExecution()) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
